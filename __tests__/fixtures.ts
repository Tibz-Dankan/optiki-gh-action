import type { MultiplePageScan, ScanReport } from '../src/optiki.js'

export const TOKEN = 'opt_0123456789ab_' + 'f'.repeat(64)

export function scanReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    id: 'scan-1',
    multiplePageScan: false,
    status: 'COMPLETED',
    target: {
      url: 'https://example.com',
      finalURL: 'https://example.com/',
      route: '/',
      pageTitle: 'Example | Home',
    },
    scores: { overall: 62, operable: 50, perceivable: 80, stable: 100, discoverable: null },
    counts: {
      findings: 3,
      critical: 1,
      serious: 1,
      moderate: 1,
      minor: 0,
      rulesPassed: 14,
      rulesFailed: 2,
      findingsTruncated: false,
    },
    error: null,
    rules: [
      {
        ruleID: 'OPK-001',
        name: 'Buttons have accessible names',
        category: 'OPERABLE',
        severity: 'CRITICAL',
        result: 'FAIL',
        findingsCount: 2,
      },
      {
        ruleID: 'OPK-002',
        name: 'Images have alt text',
        category: 'PERCEIVABLE',
        severity: 'SERIOUS',
        result: 'FAIL',
        findingsCount: 1,
      },
      {
        ruleID: 'OPK-003',
        name: 'Page has a title',
        category: 'DISCOVERABLE',
        severity: 'MODERATE',
        result: 'PASS',
        findingsCount: 0,
      },
    ],
    findings: [
      {
        id: 'f1',
        ruleID: 'OPK-001',
        severity: 'CRITICAL',
        selectorPath: 'body > button:nth-child(1)',
        message: 'Button has no accessible name',
      },
      {
        id: 'f2',
        ruleID: 'OPK-001',
        severity: 'SERIOUS',
        selectorPath: 'a[data-x="a|b"]',
        message: 'Link text is\nambiguous',
      },
      {
        id: 'f3',
        ruleID: 'OPK-002',
        severity: 'MODERATE',
        selectorPath: 'img',
        message: 'Image has no alt text',
      },
    ],
    ...overrides,
  }
}

export function multiplePageScan(overrides: Partial<MultiplePageScan> = {}): MultiplePageScan {
  return {
    id: 'multi-1',
    multiplePageScan: true,
    status: 'COMPLETED',
    maxPages: 25,
    target: { startURL: 'https://example.com', origin: 'https://example.com' },
    progress: { pagesDiscovered: 3, pagesScanned: 2, pagesSkipped: 1, limitReached: false },
    scores: { overall: 88, operable: 90, perceivable: 85, stable: 90, discoverable: 80 },
    counts: { findings: 4, critical: 0, serious: 2, moderate: 1, minor: 1 },
    error: null,
    pages: [
      {
        id: 'page-1',
        route: '/',
        url: 'https://example.com/',
        status: 'COMPLETED',
        scores: { overall: 92, operable: 95, perceivable: 90, stable: 90, discoverable: 85 },
        counts: { findings: 1, critical: 0, serious: 0, moderate: 1, minor: 0 },
      },
      {
        id: 'page-2',
        route: '/about',
        url: 'https://example.com/about',
        status: 'COMPLETED',
        scores: { overall: 84, operable: 85, perceivable: 80, stable: 90, discoverable: 75 },
        counts: { findings: 3, critical: 0, serious: 2, moderate: 0, minor: 1 },
      },
    ],
    rules: [
      {
        ruleID: 'OPK-002',
        name: 'Images have alt text',
        category: 'PERCEIVABLE',
        severity: 'SERIOUS',
        pagesFailed: 1,
        pagesChecked: 2,
        findings: 2,
      },
      {
        ruleID: 'OPK-003',
        name: 'Page has a title',
        category: 'DISCOVERABLE',
        severity: 'MODERATE',
        pagesFailed: 0,
        pagesChecked: 2,
        findings: 0,
      },
    ],
    skipped: [{ url: 'https://example.com/missing', reason: 'NOT_FOUND', httpStatus: 404 }],
    ...overrides,
  }
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function success(data: unknown, status = 201): Response {
  return jsonResponse(status, { status: 'success', message: 'ok', data })
}

export function failure(status: number, error: string, message: string, headers: Record<string, string> = {}) {
  return jsonResponse(status, { status: 'fail', error, message }, headers)
}
