import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../src/main.js'
import { TOKEN_SETTINGS_URL } from '../src/optiki.js'
import { TOKEN, multiplePageScan, scanReport, success } from './fixtures.js'

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  setSecret: vi.fn(),
}))

const fetchMock = vi.fn<typeof fetch>()

function inputs(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(`INPUT_${name.toUpperCase()}`, value)
}

function outputs(): Record<string, unknown> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls)
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // Keep the runner's own environment out when these tests run in GitHub Actions
  for (const name of [
    'OPTIKI_API_TOKEN',
    'GITHUB_STEP_SUMMARY',
    'GITHUB_EVENT_PATH',
    'GITHUB_REPOSITORY',
    'GITHUB_REF_NAME',
    'GITHUB_HEAD_REF',
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_SERVER_URL',
  ]) {
    vi.stubEnv(name, '')
  }
  inputs({ url: 'https://example.com', multiplePageScan: 'false', minScore: '0', token: '', apiUrl: '' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  fetchMock.mockReset()
})

describe('run', () => {
  it('fails with setup steps when the token is missing', async () => {
    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(TOKEN_SETTINGS_URL))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a url that is not a web address', async () => {
    inputs({ url: 'example.com', token: TOKEN })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('url must be an absolute http(s) URL, got "example.com".')
  })

  it('rejects a minScore outside 0-100', async () => {
    inputs({ minScore: '150', token: TOKEN })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('minScore must be a whole number'))
  })

  it('scans a page with the OPTIKI_API_TOKEN env var and reports the result', async () => {
    vi.stubEnv('OPTIKI_API_TOKEN', TOKEN)
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/site')
    vi.stubEnv('GITHUB_REF_NAME', 'main')
    vi.stubEnv('GITHUB_SHA', 'abc1234def')
    const summaryPath = join(mkdtempSync(join(tmpdir(), 'optiki-summary-')), 'summary.md')
    writeFileSync(summaryPath, '')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summaryPath)
    fetchMock.mockResolvedValueOnce(success(scanReport()))

    await run()

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://optikiapi.tuliime.com/client/v1/scan')
    expect(JSON.parse(init?.body as string)).toEqual({
      url: 'https://example.com',
      repository: 'acme/site',
      branch: 'main',
      commitSHA: 'abc1234def',
    })
    expect(core.setSecret).toHaveBeenCalledWith(TOKEN)
    expect(outputs()).toEqual({
      scanId: 'scan-1',
      status: 'COMPLETED',
      score: 62,
      findings: 3,
      reportUrl: 'https://optikii.netlify.app/u/scans/scan-1',
    })
    expect(readFileSync(summaryPath, 'utf8')).toContain('Optiki AI legibility score: 62/100')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails when the score is below minScore', async () => {
    inputs({ token: TOKEN, minScore: '75' })
    fetchMock.mockResolvedValueOnce(success(scanReport()))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('The overall score 62 is below minScore 75.')
  })

  it('passes when the score meets minScore', async () => {
    inputs({ token: TOKEN, minScore: '62' })
    fetchMock.mockResolvedValueOnce(success(scanReport()))

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('warns instead of failing when there is no score to check', async () => {
    inputs({ token: TOKEN, minScore: '75' })
    const report = scanReport()
    fetchMock.mockResolvedValueOnce(success({ ...report, scores: { ...report.scores, overall: null } }))

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalled()
    expect(outputs().score).toBe('')
  })

  it('reports an API error', async () => {
    inputs({ token: TOKEN })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'fail', error: 'NOT_HTML', message: 'That page is not HTML' }), {
        status: 422,
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Optiki API error: That page is not HTML')
  })

  it('runs a multiple-page scan without CI details', async () => {
    inputs({ token: TOKEN, multiplePageScan: 'true', apiUrl: 'https://api.test/client/v1' })
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/site')
    fetchMock
      .mockResolvedValueOnce(success(multiplePageScan({ status: 'QUEUED' })))
      .mockResolvedValueOnce(success(multiplePageScan(), 200))

    await run()

    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      url: 'https://example.com',
      multiplePageScan: true,
    })
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.test/client/v1/scan/multiple/multi-1')
    expect(outputs()).toMatchObject({
      scanId: 'multi-1',
      score: 88,
      reportUrl: 'https://optikii.netlify.app/u/scans/multiple/multi-1',
    })
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails when the multiple-page scan fails', async () => {
    inputs({ token: TOKEN, multiplePageScan: 'true' })
    fetchMock
      .mockResolvedValueOnce(success(multiplePageScan({ status: 'QUEUED' })))
      .mockResolvedValueOnce(
        success(
          multiplePageScan({ status: 'FAILED', error: { code: 'FAILED', message: 'Start page failed' } }),
          200
        )
      )

    await run()

    expect(outputs().status).toBe('FAILED')
    expect(core.setFailed).toHaveBeenCalledWith('The Optiki scan failed: Start page failed')
  })
})
