import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ciContext } from '../src/github.js'

const runEnv = {
  GITHUB_REPOSITORY: 'acme/site',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_RUN_ID: '42',
}

function eventFile(event: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'optiki-event-')), 'event.json')
  writeFileSync(path, JSON.stringify(event))
  return path
}

describe('ciContext', () => {
  it('describes a push', () => {
    const context = ciContext({
      ...runEnv,
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: 'abc1234def',
      GITHUB_EVENT_PATH: eventFile({ ref: 'refs/heads/main' }),
    })

    expect(context).toEqual({
      repository: 'acme/site',
      branch: 'main',
      commitSHA: 'abc1234def',
      runURL: 'https://github.com/acme/site/actions/runs/42',
    })
  })

  it('uses the head branch and commit of a pull request', () => {
    const context = ciContext({
      ...runEnv,
      GITHUB_REF_NAME: '7/merge',
      GITHUB_HEAD_REF: 'feature/nav',
      GITHUB_SHA: 'merge0000',
      GITHUB_EVENT_PATH: eventFile({ pull_request: { number: 7, head: { sha: 'head1111' } } }),
    })

    expect(context).toMatchObject({ branch: 'feature/nav', commitSHA: 'head1111', prNumber: 7 })
  })

  it('leaves out what a local run does not have', () => {
    expect(ciContext({ GITHUB_EVENT_PATH: '/does/not/exist.json' })).toEqual({})
  })
})
