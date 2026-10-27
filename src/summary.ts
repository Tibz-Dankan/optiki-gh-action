// Markdown for the job summary. These are pure functions so they can be tested without a runner.
import type { MultiplePageScan, ScanReport, Scores, SeverityCounts } from './optiki.js'

const MAX_FINDINGS = 20

export function scoreTone(score: number | null): string {
  if (score === null) return '⚪'
  if (score >= 90) return '🟢'
  if (score >= 70) return '🟡'
  if (score >= 50) return '🟠'
  return '🔴'
}

export function formatScore(score: number | null): string {
  return score === null ? 'n/a' : String(score)
}

export function scanSummary(report: ScanReport, reportUrl: string): string {
  const target = report.target.finalURL || report.target.url || report.target.route
  const lines = [
    heading(report.scores.overall),
    '',
    `Scanned ${link(target, target)}${report.target.pageTitle ? ` (${cell(report.target.pageTitle)})` : ''}.`,
    '',
    ...scoresTable(report.scores),
    '',
    findingsLine(report.counts),
  ]

  const failedRules = report.rules.filter((rule) => rule.result === 'FAIL')
  if (failedRules.length > 0) {
    lines.push(
      '',
      '### Failed rules',
      '',
      '| Rule | Category | Severity | Findings |',
      '| --- | --- | --- | ---: |',
      ...failedRules.map(
        (rule) =>
          `| ${cell(rule.name)} (\`${rule.ruleID}\`) | ${titleCase(rule.category)} | ${titleCase(rule.severity)} | ${rule.findingsCount} |`
      )
    )
  }

  if (report.findings.length > 0) {
    const shown = report.findings.slice(0, MAX_FINDINGS)
    const more = report.counts.findings - shown.length
    lines.push(
      '',
      '### Findings',
      '',
      '| Severity | Rule | Issue | Element |',
      '| --- | --- | --- | --- |',
      ...shown.map(
        (finding) =>
          `| ${titleCase(finding.severity)} | \`${finding.ruleID}\` | ${cell(finding.message)} | ${code(finding.selectorPath)} |`
      )
    )
    if (more > 0) lines.push('', `_+${more} more in the full report._`)
  }

  lines.push('', reportLink(reportUrl))
  return lines.join('\n') + '\n'
}

export function multiplePageScanSummary(scan: MultiplePageScan, reportUrl: string): string {
  const { progress } = scan
  const lines = [
    heading(scan.scores.overall),
    '',
    `Crawled ${link(scan.target.startURL, scan.target.startURL)}: scanned ${progress.pagesScanned} ` +
      `of ${progress.pagesDiscovered} pages found (limit ${scan.maxPages}), skipped ${progress.pagesSkipped}.`,
    '',
    ...(scan.error ? [`> **Scan failed:** ${cell(scan.error.message)}`, ''] : []),
    ...scoresTable(scan.scores),
    '',
    findingsLine(scan.counts),
  ]

  const pages = scan.pages ?? []
  if (pages.length > 0) {
    lines.push(
      '',
      '### Pages',
      '',
      '| Page | Score | Findings | Status |',
      '| --- | ---: | ---: | --- |',
      ...pages.map(
        (page) =>
          `| ${page.url ? link(page.route, page.url) : code(page.route)} | ${scoreTone(page.scores.overall)} ${formatScore(page.scores.overall)} | ${page.counts.findings} | ${titleCase(page.status)} |`
      )
    )
  }

  const failedRules = (scan.rules ?? []).filter((rule) => rule.pagesFailed > 0)
  if (failedRules.length > 0) {
    lines.push(
      '',
      '### Failed rules',
      '',
      '| Rule | Severity | Pages failed | Findings |',
      '| --- | --- | ---: | ---: |',
      ...failedRules.map(
        (rule) =>
          `| ${cell(rule.name)} (\`${rule.ruleID}\`) | ${titleCase(rule.severity)} | ${rule.pagesFailed}/${rule.pagesChecked} | ${rule.findings} |`
      )
    )
  }

  lines.push('', reportLink(reportUrl))
  return lines.join('\n') + '\n'
}

function heading(score: number | null): string {
  return `## ${scoreTone(score)} Optiki AI legibility score: ${formatScore(score)}${score === null ? '' : '/100'}`
}

function scoresTable(scores: Scores): string[] {
  return [
    '| Operable | Perceivable | Stable | Discoverable |',
    '| :---: | :---: | :---: | :---: |',
    `| ${[scores.operable, scores.perceivable, scores.stable, scores.discoverable]
      .map((score) => `${scoreTone(score)} ${formatScore(score)}`)
      .join(' | ')} |`,
  ]
}

function findingsLine(counts: SeverityCounts): string {
  return (
    `**${counts.findings} findings:** ${counts.critical} critical, ${counts.serious} serious, ` +
    `${counts.moderate} moderate, ${counts.minor} minor`
  )
}

function reportLink(url: string): string {
  return `[View the full report on Optiki](${url}) (sign in as the API token's owner)`
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')
}

// Keeps text from breaking out of a markdown table cell
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function code(text: string): string {
  return `\`${cell(text).replace(/`/g, "'")}\``
}

function link(text: string, url: string): string {
  const href = url.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
  return `[${cell(text).replace(/[[\]]/g, '')}](${href})`
}
