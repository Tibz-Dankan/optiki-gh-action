# Optiki AI Legibility Scan

A GitHub Action that scans your site with [optikí](https://optikii.netlify.app) to show how legible it is to AI agents and screen readers. Each scan gives a 0–100 score, overall and for each category: Operable, Perceivable, Stable and Discoverable. It also lists every finding with the element it points to.

The scores, failed rules and findings are written to the workflow run's summary. Optionally, the job fails when the score drops below a threshold you set.

## Quick start

**1. Create an API token.** Sign in at [optikii.netlify.app](https://optikii.netlify.app) and go to **Settings → [API tokens](https://optikii.netlify.app/u/settings/api-tokens) → Create**.
- The default permissions, `scan:create:own` and `scan:view:own`, are exactly what the action needs.
- Copy the token. It is shown only once.

**2. Save it as a secret.** In your repository, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `OPTIKI_API_TOKEN` and paste the token.

**3. Add a workflow.** For example, `.github/workflows/optiki.yml`:

```yaml
name: AI legibility

on:
  push:
    branches: [main]
  pull_request:

jobs:
  optiki:
    runs-on: ubuntu-latest
    steps:
      - uses: Tibz-Dankan/optiki-gh-action@v1
        with:
          url: https://example.com
        env:
          OPTIKI_API_TOKEN: ${{ secrets.OPTIKI_API_TOKEN }}
```

That's it. Open the workflow run to see the report in its summary.

## Scan multiple pages

Set `multiplePageScan: true` to crawl the site from `url` and scan up to 25 of its pages:

```yaml
      - uses: Tibz-Dankan/optiki-gh-action@v1
        with:
          url: https://example.com
          multiplePageScan: true
        env:
          OPTIKI_API_TOKEN: ${{ secrets.OPTIKI_API_TOKEN }}
```

The overall score is the average of the scanned pages. The summary lists every page with its score and shows which rules failed on how many pages.

## Fail the build on a low score

Set `minScore` to fail the job when the overall score is below it:

```yaml
      - uses: Tibz-Dankan/optiki-gh-action@v1
        with:
          url: https://example.com
          minScore: 75
        env:
          OPTIKI_API_TOKEN: ${{ secrets.OPTIKI_API_TOKEN }}
```

The job always fails if the scan itself fails, for example when the page can't be loaded or the token is invalid.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | yes | | The page to scan. With `multiplePageScan`, the page the crawl starts from. It must be publicly reachable. |
| `multiplePageScan` | no | `false` | Crawl and scan up to 25 pages of the same site. |
| `minScore` | no | `0` | Fail the job when the overall score (0–100) is below this. `0` never fails on score. |
| `token` | no | `$OPTIKI_API_TOKEN` | The API token, if you'd rather pass it as an input: `token: ${{ secrets.OPTIKI_API_TOKEN }}`. |

## Outputs

| Output | Description |
| --- | --- |
| `scanId` | The ID of the scan. |
| `status` | `COMPLETED` or `FAILED`. |
| `score` | The overall score (0–100). Empty when no rule applied to the page. |
| `findings` | The number of findings. |
| `reportUrl` | Link to the full report on optikí. Sign in as the token's owner to view it. |

Give the step an `id` to use them:

```yaml
      - uses: Tibz-Dankan/optiki-gh-action@v1
        id: optiki
        with:
          url: https://example.com
        env:
          OPTIKI_API_TOKEN: ${{ secrets.OPTIKI_API_TOKEN }}

      - run: echo "Scored ${{ steps.optiki.outputs.score }}/100, see ${{ steps.optiki.outputs.reportUrl }}"
```

## Good to know

- **The URL must be public.** Scans run on optikí's servers, so `localhost` and private addresses are blocked. To scan a pull request before it ships, pass the URL of its preview deployment, such as a Netlify or Vercel preview.
- **Reports are private.** They're saved to the token owner's optikí account, under **Scans**.
- **Single-page scans are linked to the commit.** Each one records the repository, branch, commit, pull request and run. Multiple-page scans don't record these yet.
- **Timing.** A single page takes up to about 30 seconds. A multiple-page scan is queued and usually takes a few minutes. The log shows its progress.
- **Rate limits.** Each token can start 60 scans per 10 minutes. When optikí is busy, the action waits and retries automatically.

## Development

```bash
npm ci
npm run all   # typecheck, test, and bundle into dist/
```

`dist/` is committed because GitHub runs the action from the repository. Run `npm run build` and commit `dist/` with every change to `src/`. CI fails when the two are out of sync.

To try the bundled action locally against the real API:

```bash
INPUT_URL=https://example.com INPUT_MULTIPLEPAGESCAN=false INPUT_MINSCORE=0 \
OPTIKI_API_TOKEN=opt_... node dist/index.js
```
