import * as core from '@actions/core'
import { ciContext } from './github.js'
import {
  DEFAULT_API_URL,
  OptikiClient,
  TOKEN_SETTINGS_URL,
  multiplePageReportUrl,
  scanReportUrl,
  type ScanError,
  type Scores,
  type SeverityCounts,
} from './optiki.js'
import { formatScore, multiplePageScanSummary, scanSummary } from './summary.js'

type Inputs = {
  url: string
  multiplePageScan: boolean
  minScore: number
  token: string
  apiUrl: string
}

type ScanResult = {
  id: string
  status: string
  scores: Scores
  counts: SeverityCounts
  error: ScanError
  reportUrl: string
  summary: string
}

export async function run(): Promise<void> {
  try {
    const inputs = readInputs()
    const client = new OptikiClient({ apiUrl: inputs.apiUrl, token: inputs.token, log: core.info })
    const result = inputs.multiplePageScan
      ? await scanMultiplePages(client, inputs.url)
      : await scanPage(client, inputs.url)

    logResult(result)
    core.setOutput('scanId', result.id)
    core.setOutput('status', result.status)
    core.setOutput('score', result.scores.overall ?? '')
    core.setOutput('findings', result.counts.findings)
    core.setOutput('reportUrl', result.reportUrl)
    if (process.env.GITHUB_STEP_SUMMARY) await core.summary.addRaw(result.summary).write()

    if (result.status === 'FAILED') {
      core.setFailed(`The Optiki scan failed: ${result.error?.message ?? 'unknown error'}`)
      return
    }
    checkMinScore(result.scores.overall, inputs.minScore)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

function readInputs(): Inputs {
  const url = core.getInput('url', { required: true })
  if (!isWebUrl(url)) throw new Error(`url must be an absolute http(s) URL, got "${url}".`)

  const rawMinScore = core.getInput('minScore') || '0'
  const minScore = Number(rawMinScore)
  if (!Number.isInteger(minScore) || minScore < 0 || minScore > 100) {
    throw new Error(`minScore must be a whole number from 0 to 100, got "${rawMinScore}".`)
  }

  const token = (core.getInput('token') || process.env.OPTIKI_API_TOKEN || '').trim()
  if (!token) {
    throw new Error(
      `Missing the Optiki API token. Create one at ${TOKEN_SETTINGS_URL}, save it as the OPTIKI_API_TOKEN ` +
        'repository secret, and pass it to this step with env: OPTIKI_API_TOKEN: ${{ secrets.OPTIKI_API_TOKEN }}'
    )
  }
  core.setSecret(token)

  return {
    url,
    multiplePageScan: core.getInput('multiplePageScan') !== '' && core.getBooleanInput('multiplePageScan'),
    minScore,
    token,
    apiUrl: core.getInput('apiUrl') || DEFAULT_API_URL,
  }
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

async function scanPage(client: OptikiClient, url: string): Promise<ScanResult> {
  core.info(`Scanning ${url} ...`)
  const report = await client.scanPage(url, ciContext())
  const reportUrl = scanReportUrl(report.id)
  return { ...report, reportUrl, summary: scanSummary(report, reportUrl) }
}

async function scanMultiplePages(client: OptikiClient, url: string): Promise<ScanResult> {
  core.info(`Starting a multiple-page scan from ${url} ...`)
  const started = await client.startMultiplePageScan(url)
  const reportUrl = multiplePageReportUrl(started.id)
  core.info(`Follow along at ${reportUrl}`)

  const scan = await client.waitForMultiplePageScan(started.id)
  return { ...scan, reportUrl, summary: multiplePageScanSummary(scan, reportUrl) }
}

function logResult({ status, scores, counts, reportUrl }: ScanResult): void {
  core.info('')
  core.info(`Scan ${status.toLowerCase()}`)
  core.info(`Overall score: ${formatScore(scores.overall)}`)
  core.info(`  Operable:     ${formatScore(scores.operable)}`)
  core.info(`  Perceivable:  ${formatScore(scores.perceivable)}`)
  core.info(`  Stable:       ${formatScore(scores.stable)}`)
  core.info(`  Discoverable: ${formatScore(scores.discoverable)}`)
  core.info(
    `Findings: ${counts.findings} (${counts.critical} critical, ${counts.serious} serious, ` +
      `${counts.moderate} moderate, ${counts.minor} minor)`
  )
  core.info(`Report: ${reportUrl}`)
}

function checkMinScore(score: number | null, minScore: number): void {
  if (minScore === 0) return
  if (score === null) {
    core.warning(`No rule applied, so there is no overall score to check against minScore ${minScore}.`)
    return
  }
  if (score < minScore) {
    core.setFailed(`The overall score ${score} is below minScore ${minScore}.`)
    return
  }
  core.info(`The overall score ${score} meets minScore ${minScore}.`)
}
