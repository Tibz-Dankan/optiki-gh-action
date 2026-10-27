// Client for the Optiki token API (https://optikiapi.tuliime.com/client/v1). The response types mirror the
// subset of the Optiki scan types the action reads.

export const DEFAULT_API_URL = 'https://optikiapi.tuliime.com/client/v1'
export const APP_URL = 'https://optikii.netlify.app'
export const TOKEN_SETTINGS_URL = `${APP_URL}/u/settings/api-tokens`

export type Severity = 'CRITICAL' | 'SERIOUS' | 'MODERATE' | 'MINOR'
export type RuleCategory = 'OPERABLE' | 'PERCEIVABLE' | 'STABLE' | 'DISCOVERABLE'
export type ScanStatus = 'RUNNING' | 'COMPLETED' | 'FAILED'
export type MultiplePageScanStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export type Scores = {
  overall: number | null
  operable: number | null
  perceivable: number | null
  stable: number | null
  discoverable: number | null
}

export type SeverityCounts = {
  findings: number
  critical: number
  serious: number
  moderate: number
  minor: number
}

export type ScanError = { code: string; message: string } | null

export type ScanReport = {
  id: string
  multiplePageScan: false
  status: ScanStatus
  target: {
    url: string | null
    finalURL: string | null
    route: string
    pageTitle: string | null
  }
  scores: Scores
  counts: SeverityCounts & {
    rulesPassed: number
    rulesFailed: number
    findingsTruncated: boolean
  }
  error: ScanError
  rules: {
    ruleID: string
    name: string
    category: RuleCategory
    severity: Severity
    result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'NEEDS_RENDERED'
    findingsCount: number
  }[]
  findings: {
    id: string
    ruleID: string
    severity: Severity
    selectorPath: string
    message: string
  }[]
}

export type MultiplePageScan = {
  id: string
  multiplePageScan: true
  status: MultiplePageScanStatus
  maxPages: number
  target: { startURL: string; origin: string | null }
  progress: {
    pagesDiscovered: number
    pagesScanned: number
    pagesSkipped: number
    limitReached: boolean
  }
  scores: Scores
  counts: SeverityCounts
  error: ScanError
  // Only the detail endpoint returns these; the create response is a summary
  pages?: {
    id: string
    route: string
    url: string | null
    status: ScanStatus
    scores: Scores
    counts: SeverityCounts
  }[]
  rules?: {
    ruleID: string
    name: string
    category: RuleCategory
    severity: Severity
    pagesFailed: number
    pagesChecked: number
    findings: number
  }[]
  skipped?: { url: string; reason: string; httpStatus: number | null }[]
}

// CI details attached to a single-page scan; the API rejects them on a multiple-page scan
export type CIContext = {
  repository?: string
  branch?: string
  commitSHA?: string
  prNumber?: number
  runURL?: string
}

export class OptikiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string
  ) {
    super(message)
    this.name = 'OptikiError'
  }
}

export type OptikiClientOptions = {
  apiUrl?: string
  token: string
  log?: (message: string) => void
  sleep?: (ms: number) => Promise<void>
}

const REQUEST_TIMEOUT_MS = 120_000
const MAX_BUSY_RETRIES = 3
const MAX_RETRY_AFTER_SECONDS = 120
const POLL_INTERVAL_MS = 5_000
// A multiple-page crawl takes up to 6 minutes, and up to 10 can be queued ahead of it
const POLL_TIMEOUT_MS = 30 * 60_000
const MAX_POLL_ERRORS = 3

export class OptikiClient {
  private readonly apiUrl: string
  private readonly token: string
  private readonly log: (message: string) => void
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: OptikiClientOptions) {
    this.apiUrl = (options.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '')
    this.token = options.token
    this.log = options.log ?? (() => {})
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  // Scans one page and answers with the full report once it is done
  scanPage(url: string, ci: CIContext = {}): Promise<ScanReport> {
    return this.request<ScanReport>('POST', '/scan', { url, ...ci })
  }

  // Queues a crawl from url and answers at once with its summary
  startMultiplePageScan(url: string): Promise<MultiplePageScan> {
    return this.request<MultiplePageScan>('POST', '/scan', { url, multiplePageScan: true })
  }

  getMultiplePageScan(id: string): Promise<MultiplePageScan> {
    return this.request<MultiplePageScan>('GET', `/scan/multiple/${encodeURIComponent(id)}`)
  }

  // Polls a multiple-page scan until it is COMPLETED or FAILED
  async waitForMultiplePageScan(
    id: string,
    { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS } = {}
  ): Promise<MultiplePageScan> {
    const deadline = Date.now() + timeoutMs
    let lastProgress = ''
    let errors = 0

    while (true) {
      try {
        const scan = await this.getMultiplePageScan(id)
        errors = 0
        if (scan.status === 'COMPLETED' || scan.status === 'FAILED') return scan

        const progress =
          scan.status === 'QUEUED'
            ? 'Waiting in the queue...'
            : `Scanned ${scan.progress.pagesScanned}/${scan.maxPages} pages ` +
              `(${scan.progress.pagesDiscovered} discovered, ${scan.progress.pagesSkipped} skipped)`
        if (progress !== lastProgress) this.log(progress)
        lastProgress = progress
      } catch (error) {
        // A client error won't fix itself; a blip in the network or the server might
        const transient = !(error instanceof OptikiError) || error.status >= 500
        errors += 1
        if (!transient || errors >= MAX_POLL_ERRORS) throw error
        this.log(`Checking the scan failed, retrying: ${(error as Error).message}`)
      }

      if (Date.now() + intervalMs > deadline) {
        throw new Error(
          `The multiple-page scan didn't finish within ${Math.round(timeoutMs / 60_000)} minutes. ` +
            `It may still finish; see ${multiplePageReportUrl(id)}`
        )
      }
      await this.sleep(intervalMs)
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let response: Response
      try {
        response = await fetch(`${this.apiUrl}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Error(`The Optiki API didn't respond within ${REQUEST_TIMEOUT_MS / 1000}s (${method} ${path}).`)
        }
        throw new Error(`Couldn't reach the Optiki API at ${this.apiUrl}: ${(error as Error).message}`)
      }

      if (response.ok) {
        const payload = (await response.json()) as { data: T }
        return payload.data
      }

      const error = await toOptikiError(response)
      const retryAfter = Number(response.headers.get('Retry-After') ?? 10)
      if (
        response.status === 429 &&
        attempt < MAX_BUSY_RETRIES &&
        Number.isFinite(retryAfter) &&
        retryAfter <= MAX_RETRY_AFTER_SECONDS
      ) {
        this.log(`Optiki is busy (${error.reason || 'TOO_MANY_REQUESTS'}), retrying in ${retryAfter}s...`)
        await this.sleep(retryAfter * 1000)
        continue
      }
      throw error
    }
  }
}

async function toOptikiError(response: Response): Promise<OptikiError> {
  let reason = ''
  let message = ''
  try {
    const body = (await response.json()) as { error?: string; message?: string }
    reason = body.error ?? ''
    message = body.message ?? ''
  } catch {
    // Not the API's JSON error envelope, e.g. a proxy error page
  }
  message ||= `${response.status} ${response.statusText}`.trim()

  if (response.status === 401) {
    message += ` Create a new API token at ${TOKEN_SETTINGS_URL} and save it as the OPTIKI_API_TOKEN secret.`
  } else if (reason === 'MISSING_PERMISSION') {
    message += ` Create a token with the scan:create:own and scan:view:own permissions at ${TOKEN_SETTINGS_URL}.`
  }
  return new OptikiError(response.status, reason, `Optiki API error: ${message}`)
}

export function scanReportUrl(id: string): string {
  return `${APP_URL}/u/scans/${id}`
}

export function multiplePageReportUrl(id: string): string {
  return `${APP_URL}/u/scans/multiple/${id}`
}
