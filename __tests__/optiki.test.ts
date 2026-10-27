import { afterEach, describe, expect, it, vi } from 'vitest'
import { OptikiClient, OptikiError, TOKEN_SETTINGS_URL } from '../src/optiki.js'
import { TOKEN, failure, jsonResponse, multiplePageScan, scanReport, success } from './fixtures.js'

function setup(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)

  const sleep = vi.fn(async (_ms: number) => {})
  const log = vi.fn()
  const client = new OptikiClient({ apiUrl: 'https://api.test/client/v1/', token: TOKEN, sleep, log })
  return { client, fetchMock, sleep, log }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OptikiClient', () => {
  it('scans a page with the bearer token and CI details', async () => {
    const { client, fetchMock } = setup(success(scanReport()))

    const report = await client.scanPage('https://example.com', { repository: 'acme/site', prNumber: 7 })

    expect(report.id).toBe('scan-1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.test/client/v1/scan')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      url: 'https://example.com',
      repository: 'acme/site',
      prNumber: 7,
    })
  })

  it('starts a multiple-page scan without CI details', async () => {
    const { client, fetchMock } = setup(success(multiplePageScan({ status: 'QUEUED' })))

    await client.startMultiplePageScan('https://example.com')

    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      url: 'https://example.com',
      multiplePageScan: true,
    })
  })

  it('explains how to fix an expired token', async () => {
    const { client } = setup(failure(401, 'TOKEN_EXPIRED', 'This API token has expired!'))

    const error = await client.scanPage('https://example.com').catch((error: unknown) => error)

    expect(error).toBeInstanceOf(OptikiError)
    expect(error).toMatchObject({ status: 401, reason: 'TOKEN_EXPIRED' })
    expect((error as Error).message).toContain('This API token has expired!')
    expect((error as Error).message).toContain(TOKEN_SETTINGS_URL)
  })

  it('names the permissions a token is missing', async () => {
    const { client } = setup(
      failure(403, 'MISSING_PERMISSION', 'This API token does not have the scan:view:own permission!')
    )

    await expect(client.getMultiplePageScan('multi-1')).rejects.toThrow(/scan:create:own and scan:view:own/)
  })

  it('handles an error that is not JSON', async () => {
    const { client } = setup(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))

    await expect(client.scanPage('https://example.com')).rejects.toThrow('Optiki API error: 502 Bad Gateway')
  })

  it('retries after Retry-After when Optiki is busy', async () => {
    const { client, fetchMock, sleep } = setup(
      failure(429, 'RENDERER_BUSY', 'busy', { 'Retry-After': '10' }),
      success(scanReport())
    )

    const report = await client.scanPage('https://example.com')

    expect(report.id).toBe('scan-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10_000)
  })

  it('gives up when Retry-After is too long to wait for', async () => {
    const { client, sleep } = setup(
      failure(429, 'TOO_MANY_REQUESTS', 'Too many scans', { 'Retry-After': '600' })
    )

    await expect(client.scanPage('https://example.com')).rejects.toThrow('Too many scans')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops retrying a busy server after three retries', async () => {
    const busy = () => failure(429, 'RENDERER_BUSY', 'busy', { 'Retry-After': '1' })
    const { client, fetchMock } = setup(busy(), busy(), busy(), busy())

    await expect(client.scanPage('https://example.com')).rejects.toThrow('busy')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('polls a multiple-page scan until it completes', async () => {
    const { client, fetchMock, sleep, log } = setup(
      success(multiplePageScan({ status: 'QUEUED' }), 200),
      success(
        multiplePageScan({
          status: 'RUNNING',
          progress: { pagesDiscovered: 5, pagesScanned: 1, pagesSkipped: 0, limitReached: false },
        }),
        200
      ),
      success(multiplePageScan(), 200)
    )

    const scan = await client.waitForMultiplePageScan('multi-1')

    expect(scan.status).toBe('COMPLETED')
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/client/v1/scan/multiple/multi-1')
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('Waiting in the queue...')
    expect(log).toHaveBeenCalledWith('Scanned 1/25 pages (5 discovered, 0 skipped)')
  })

  it('returns a failed multiple-page scan for the caller to report', async () => {
    const { client } = setup(
      success(multiplePageScan({ status: 'FAILED', error: { code: 'FAILED', message: 'Start page failed' } }), 200)
    )

    const scan = await client.waitForMultiplePageScan('multi-1')

    expect(scan.error?.message).toBe('Start page failed')
  })

  it('keeps polling through a server error', async () => {
    const { client } = setup(
      jsonResponse(500, { status: 'error', error: 'INTERNAL_SERVER_ERROR', message: 'Ooops' }),
      success(multiplePageScan(), 200)
    )

    await expect(client.waitForMultiplePageScan('multi-1')).resolves.toMatchObject({ status: 'COMPLETED' })
  })

  it('stops polling on a client error', async () => {
    const { client, fetchMock } = setup(failure(404, 'NOT_FOUND', 'Multiple-page scan not found'))

    await expect(client.waitForMultiplePageScan('multi-1')).rejects.toThrow('Multiple-page scan not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up polling after the timeout', async () => {
    const { client } = setup(success(multiplePageScan({ status: 'RUNNING' }), 200))

    await expect(client.waitForMultiplePageScan('multi-1', { intervalMs: 5_000, timeoutMs: 1_000 })).rejects.toThrow(
      /didn't finish/
    )
  })
})
