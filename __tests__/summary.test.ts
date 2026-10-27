import { describe, expect, it } from 'vitest'
import { multiplePageScanSummary, scanSummary, scoreTone } from '../src/summary.js'
import { multiplePageScan, scanReport } from './fixtures.js'

describe('scoreTone', () => {
  it('matches the Optiki score bands', () => {
    expect([95, 90, 89, 70, 69, 50, 49, null].map(scoreTone)).toEqual([
      '🟢',
      '🟢',
      '🟡',
      '🟡',
      '🟠',
      '🟠',
      '🔴',
      '⚪',
    ])
  })
})

describe('scanSummary', () => {
  const markdown = scanSummary(scanReport(), 'https://optikii.netlify.app/u/scans/scan-1')

  it('shows the overall and category scores', () => {
    expect(markdown).toContain('## 🟠 Optiki AI legibility score: 62/100')
    expect(markdown).toContain('| 🟠 50 | 🟡 80 | 🟢 100 | ⚪ n/a |')
    expect(markdown).toContain('**3 findings:** 1 critical, 1 serious, 1 moderate, 0 minor')
  })

  it('lists only the failed rules', () => {
    expect(markdown).toContain('| Buttons have accessible names (`OPK-001`) | Operable | Critical | 2 |')
    expect(markdown).toContain('Images have alt text')
    expect(markdown).not.toContain('Page has a title')
  })

  it('keeps findings inside their table cells', () => {
    expect(markdown).toContain('| Serious | `OPK-001` | Link text is ambiguous | `a[data-x="a\\|b"]` |')
    expect(markdown).toContain('(Example \\| Home)')
  })

  it('links to the report', () => {
    expect(markdown).toContain('[View the full report on Optiki](https://optikii.netlify.app/u/scans/scan-1)')
  })

  it('points to the report when there are more findings than it shows', () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      ruleID: 'OPK-001',
      severity: 'MINOR' as const,
      selectorPath: 'div',
      message: `Finding ${i}`,
    }))
    const report = scanReport({ findings, counts: { ...scanReport().counts, findings: 30 } })

    const summary = scanSummary(report, 'https://optikii.netlify.app/u/scans/scan-1')

    expect(summary).toContain('Finding 19')
    expect(summary).not.toContain('Finding 20')
    expect(summary).toContain('_+10 more in the full report._')
  })
})

describe('multiplePageScanSummary', () => {
  const markdown = multiplePageScanSummary(multiplePageScan(), 'https://optikii.netlify.app/u/scans/multiple/multi-1')

  it('shows the crawl and its scores', () => {
    expect(markdown).toContain('## 🟡 Optiki AI legibility score: 88/100')
    expect(markdown).toContain('scanned 2 of 3 pages found (limit 25), skipped 1')
  })

  it('lists each page', () => {
    expect(markdown).toContain('| [/about](https://example.com/about) | 🟡 84 | 3 | Completed |')
  })

  it('lists the rules that failed on some page', () => {
    expect(markdown).toContain('| Images have alt text (`OPK-002`) | Serious | 1/2 | 2 |')
    expect(markdown).not.toContain('Page has a title')
  })

  it('explains a failed crawl', () => {
    const failed = multiplePageScan({
      status: 'FAILED',
      error: { code: 'FAILED', message: 'The start page could not be scanned' },
      pages: [],
    })

    expect(multiplePageScanSummary(failed, 'https://x')).toContain(
      '> **Scan failed:** The start page could not be scanned'
    )
  })
})
