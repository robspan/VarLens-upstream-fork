import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import MarkdownIt from 'markdown-it'

function renderStakeholderHtml(markdown) {
  const md = new MarkdownIt({ html: false, linkify: true })
  const body = md
    .render(markdown)
    .replaceAll('<td>Passed</td>', '<td><span class="badge pass">Passed</span></td>')
    .replaceAll(
      '<td>Exact parity passed</td>',
      '<td><span class="badge pass">Exact parity passed</span></td>'
    )
    .replaceAll(
      '<td>Parity test needed</td>',
      '<td><span class="badge warn">Parity test needed</span></td>'
    )
    .replaceAll('<td>Incomplete</td>', '<td><span class="badge warn">Incomplete</span></td>')
    .replaceAll('<td>Partial</td>', '<td><span class="badge warn">Partial</span></td>')
    .replaceAll(
      '<td>Needs attention</td>',
      '<td><span class="badge fail">Needs attention</span></td>'
    )
    .replaceAll(
      '<td>Tracked separately</td>',
      '<td><span class="badge neutral">Tracked separately</span></td>'
    )

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>VarLens Web Validation Report</title>
  <style>
    @page { margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1d2730;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      line-height: 1.45;
      background: #ffffff;
    }
    h1 {
      margin: 0 0 6px;
      padding: 0 0 10px;
      color: #102f43;
      border-bottom: 3px solid #102f43;
      font-size: 25px;
      letter-spacing: 0;
    }
    h2 {
      margin: 20px 0 8px;
      color: #102f43;
      font-size: 16px;
      border-bottom: 1px solid #b8cbd6;
      padding-bottom: 5px;
    }
    h3 {
      margin: 16px 0 8px;
      color: #31485a;
      font-size: 13px;
    }
    p { margin: 6px 0 8px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 16px;
      page-break-inside: auto;
    }
    tr { page-break-inside: avoid; }
    th {
      background: #eaf3f7;
      color: #17384d;
      font-weight: 700;
      text-align: left;
      border: 1px solid #c8dce6;
      padding: 6px 7px;
    }
    td {
      border: 1px solid #dbe6ec;
      padding: 6px 7px;
      vertical-align: top;
    }
    tbody tr:nth-child(even) td { background: #f8fbfc; }
    code {
      color: #143d59;
      background: #edf4f7;
      border-radius: 4px;
      padding: 1px 4px;
    }
    ul { padding-left: 18px; }
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 7px;
      font-weight: 700;
      white-space: nowrap;
    }
    .pass { color: #0f5132; background: #d1e7dd; }
    .warn { color: #664d03; background: #fff3cd; }
    .fail { color: #842029; background: #f8d7da; }
    .neutral { color: #334155; background: #e2e8f0; }
  </style>
</head>
<body>
${body}
</body>
</html>`
}

async function writeStakeholderPdf(runDir, stakeholderReport) {
  const html = renderStakeholderHtml(stakeholderReport)
  const htmlPath = resolve(runDir, 'stakeholder-report.html')
  const pdfPath = resolve(runDir, 'stakeholder-report.pdf')
  await writeFile(htmlPath, html, 'utf8')

  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } })
      await page.setContent(html, { waitUntil: 'networkidle' })
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' }
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    await writeFile(
      resolve(runDir, 'stakeholder-report.pdf.error.txt'),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      'utf8'
    )
    throw error
  }
}

export { writeStakeholderPdf }
