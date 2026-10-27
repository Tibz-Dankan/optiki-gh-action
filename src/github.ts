import { readFileSync } from 'node:fs'
import type { CIContext } from './optiki.js'

type Env = Record<string, string | undefined>

type PullRequestEvent = {
  pull_request?: { number?: number; head?: { sha?: string } }
}

// Describes the workflow run so Optiki can link a scan to its commit. Fields the run doesn't have are left
// out, so the action also works outside GitHub Actions.
export function ciContext(env: Env = process.env): CIContext {
  const pullRequest = readEvent(env.GITHUB_EVENT_PATH).pull_request
  const repository = env.GITHUB_REPOSITORY || undefined
  // On a pull request GITHUB_REF_NAME is "<number>/merge" and GITHUB_SHA the merge commit
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || undefined

  const context: CIContext = {
    repository,
    branch: branch && branch.length <= 255 ? branch : undefined,
    commitSHA: pullRequest?.head?.sha || env.GITHUB_SHA || undefined,
    prNumber: pullRequest?.number,
    runURL:
      repository && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`
        : undefined,
  }

  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined)) as CIContext
}

function readEvent(path: string | undefined): PullRequestEvent {
  if (!path) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PullRequestEvent
  } catch {
    return {}
  }
}
