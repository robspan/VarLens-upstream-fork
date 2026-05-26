import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { readJsonIfExists, suiteFailed, suitePassed } from './web-report-ctrf.mjs'
import {
  flatIpcHandlers,
  ipcDomainDirs,
  latestDir,
  relative,
  repoRoot,
  stakeholderIpcAreas,
  stakeholderIpcSharedIds
} from './web-report-context.mjs'

function renderSummary(manifest, ctrf, reportAssessment) {
  const summary = ctrf.results.summary
  const status = manifest.status.toUpperCase()
  const lines = [
    '# Web Test Report',
    '',
    `Status: ${status}`,
    `Harness status: ${(manifest.harnessStatus ?? manifest.status).toUpperCase()}`,
    `Electron Postgres vs Web Postgres IPC parity: ${reportAssessment.exactIpcParityCount}/${stakeholderIpcAreas.length}`,
    `Run ID: ${manifest.runId}`,
    `Started: ${manifest.startedAt}`,
    `Finished: ${manifest.finishedAt}`,
    `Git: ${manifest.git.branch ?? 'unknown'} @ ${manifest.git.sha ?? 'unknown'}${
      manifest.git.dirty ? ' (dirty)' : ''
    }`,
    '',
    '## Suites',
    '',
    '| Suite | Required | Result | Exit | Duration ms | Command |',
    '| --- | --- | --- | ---: | ---: | --- |'
  ]

  for (const suite of manifest.suites) {
    const result = suite.skipped
      ? `skipped: ${suite.skipReason}`
      : suite.exitCode === 0
        ? 'passed'
        : 'failed'
    lines.push(
      `| ${suite.id} | ${suite.required ? 'yes' : 'no'} | ${result} | ${
        suite.exitCode ?? ''
      } | ${suite.durationMs ?? 0} | \`${suite.command ?? ''}\` |`
    )
  }

  lines.push(
    '',
    '## Test Cases',
    '',
    `Total: ${summary.tests}`,
    `Passed: ${summary.passed}`,
    `Failed: ${summary.failed}`,
    `Skipped: ${summary.skipped}`,
    `Other: ${summary.other}`,
    '',
    '## Artifacts',
    '',
    `- Stakeholder PDF: \`${relative(resolve(latestDir, 'stakeholder-report.pdf'))}\``,
    `- Technical summary: \`${relative(resolve(latestDir, 'summary.md'))}\``,
    `- Test data evidence: \`${relative(resolve(latestDir, 'test-data'))}\``,
    `- Logs: \`${relative(resolve(latestDir, 'logs'))}\``
  )

  const failures = ctrf.results.tests.filter((test) => test.status === 'failed')
  if (failures.length > 0) {
    lines.push('', '## Failures', '')
    for (const failure of failures.slice(0, 30)) {
      lines.push(
        `- ${failure.suite}: ${failure.name}${failure.message ? ` — ${failure.message}` : ''}`
      )
    }
    if (failures.length > 30) lines.push(`- ... ${failures.length - 30} more failures`)
  }

  return `${lines.join('\n')}\n`
}

function suiteById(manifest, id) {
  return manifest.suites.find((suite) => suite.id === id)
}

function suiteStatusLabel(suite) {
  if (suite === undefined) return 'Not run'
  if (suite.skipped) return suite.required ? 'Not completed' : 'Not applicable'
  return suite.exitCode === 0 ? 'Passed' : 'Failed'
}

function suiteStatusSentence(suite, passedText, skippedText, failedText) {
  if (suite === undefined) return 'Not run in this report.'
  if (suite.skipped) return skippedText
  return suite.exitCode === 0 ? passedText : failedText
}

function listIpcDomains(relativeDir) {
  const abs = resolve(repoRoot, relativeDir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .filter((file) => statSync(resolve(abs, file)).isFile())
    .map((file) => file.replace(/\.ts$/u, ''))
    .sort()
}

function ipcContractInventory() {
  const shared = listIpcDomains(ipcDomainDirs.shared)
  const preload = listIpcDomains(ipcDomainDirs.preload)
  const main = listIpcDomains(ipcDomainDirs.main)
  const preloadSet = new Set(preload)
  const mainSet = new Set(main)
  const sharedSet = new Set(shared)

  return {
    shared,
    preload,
    main,
    missingPreload: shared.filter((domain) => !preloadSet.has(domain)),
    missingMain: shared.filter((domain) => !mainSet.has(domain)),
    orphanPreload: preload.filter((domain) => !sharedSet.has(domain)),
    orphanMain: main.filter((domain) => !sharedSet.has(domain))
  }
}

function buildIpcParityMatrix(ipcInventory, ipcParityReport, paritySuite) {
  const sharedSet = new Set(ipcInventory.shared)
  const preloadSet = new Set(ipcInventory.preload)
  const mainSet = new Set(ipcInventory.main)
  const ipcResults = Array.isArray(ipcParityReport?.results) ? ipcParityReport.results : []
  const resultByArea = new Map(ipcResults.map((result) => [result.area, result]))
  const hasExactParityRun =
    paritySuite !== undefined &&
    suitePassed(paritySuite) &&
    ipcParityReport?.status === 'passed' &&
    ipcParityReport?.validatedIpcAreas === stakeholderIpcAreas.length &&
    ipcParityReport?.passedIpcAreas === stakeholderIpcAreas.length &&
    ipcParityReport?.failedIpcAreas === 0

  return stakeholderIpcAreas.map((area) => {
    const sharedId = stakeholderIpcSharedIds[area.id] ?? area.id
    const surfacePassed =
      sharedSet.has(sharedId) && preloadSet.has(sharedId) && mainSet.has(sharedId)
    const ipcResult = resultByArea.get(area.id)
    const hashMatch =
      ipcResult?.desktopHash !== null &&
      ipcResult?.desktopHash !== undefined &&
      ipcResult.desktopHash === ipcResult.webHash
    const exactParity = hasExactParityRun && ipcResult?.status === 'passed' && hashMatch
    return {
      ...area,
      surfacePassed,
      exactParity,
      desktopHash: ipcResult?.desktopHash ?? null,
      webHash: ipcResult?.webHash ?? null,
      operationCount: ipcResult?.operationCount ?? 0,
      result: exactParity ? 'Exact parity passed' : 'Parity test needed',
      evidence: exactParity
        ? `Scenario passed with matching result hash ${shortHash(ipcResult.desktopHash)} across ${ipcResult.operationCount ?? 0} operation(s).`
        : ipcResult === undefined
          ? 'No domain-specific Electron Postgres/Web Postgres result parity scenario was recorded in this report.'
          : `Scenario ${ipcResult.status}; Electron Postgres hash ${shortHash(ipcResult.desktopHash)}, Web Postgres hash ${shortHash(ipcResult.webHash)}.`
    }
  })
}

function shortHash(hash) {
  return typeof hash === 'string' && hash !== '' ? hash.slice(0, 12) : 'not available'
}

function queryMatchSummary(scenario) {
  const desktop = scenario.desktop?.queryCounts
  const web = scenario.web?.queryCounts
  if (desktop === undefined || web === undefined) return 'not recorded'

  return [
    `all ${desktop.all ?? 0}/${web.all ?? 0}`,
    `high impact ${desktop.highImpact ?? 0}/${web.highImpact ?? 0}`,
    `ClinVar pathogenic ${desktop.clinvarPathogenic ?? 0}/${web.clinvarPathogenic ?? 0}`
  ].join('; ')
}

async function buildReportAssessment(manifest, runDir) {
  const parityReport = await readJsonIfExists(resolve(runDir, 'parity', 'latest.json'))
  const ipcParityReport = await readJsonIfExists(resolve(runDir, 'parity', 'latest-ipc.json'))
  const parityScenarios = Array.isArray(parityReport?.scenarios) ? parityReport.scenarios : []
  const ipcInventory = ipcContractInventory()
  const paritySuite =
    suiteById(manifest, 'web-parity-e2e') ?? suiteById(manifest, 'web-gate-parity')
  const ipcParityMatrix = buildIpcParityMatrix(ipcInventory, ipcParityReport, paritySuite)
  const exactIpcParityCount = ipcParityMatrix.filter((row) => row.exactParity).length
  const hasIpcParityGaps = exactIpcParityCount < stakeholderIpcAreas.length
  const requiredFailure = manifest.suites.some(suiteFailed)
  const status = requiredFailure ? 'failed' : hasIpcParityGaps ? 'incomplete' : 'passed'
  const label =
    status === 'passed'
      ? 'Passed'
      : status === 'incomplete'
        ? 'Incomplete: IPC parity gaps'
        : 'Needs attention'

  return {
    status,
    label,
    parityScenarios,
    ipcParityReport,
    ipcInventory,
    ipcParityMatrix,
    exactIpcParityCount,
    hasIpcParityGaps
  }
}

async function renderStakeholderReport(manifest, ctrf, reportAssessment) {
  const summary = ctrf.results.summary
  const requiredSuites = manifest.suites.filter((suite) => suite.required)
  const failedSuites = requiredSuites.filter(suiteFailed)
  const nonBlockingSkipped = ctrf.results.tests.filter((test) => test.status === 'skipped').length
  const { parityScenarios, ipcInventory, ipcParityMatrix, exactIpcParityCount, hasIpcParityGaps } =
    reportAssessment
  const passedParityScenarios = parityScenarios.filter((scenario) => scenario.status === 'passed')
  const matchedParityHashes = parityScenarios.filter((scenario) => scenario.hashMatch === true)
  const totalDesktopVariants = parityScenarios.reduce(
    (total, scenario) => total + (scenario.desktop?.totalVariants ?? 0),
    0
  )
  const totalWebVariants = parityScenarios.reduce(
    (total, scenario) => total + (scenario.web?.totalVariants ?? 0),
    0
  )
  const staticSuite = suiteById(manifest, 'web-gate-static')
  const paritySuite =
    suiteById(manifest, 'web-parity-e2e') ?? suiteById(manifest, 'web-gate-parity')
  const dataParitySuite = suiteById(manifest, 'web-parity-e2e')
  const status =
    manifest.status === 'passed'
      ? 'Passed'
      : manifest.status === 'incomplete'
        ? 'Incomplete: IPC parity gaps'
        : 'Needs attention'
  const ipcSurfacePassed =
    staticSuite !== undefined &&
    suitePassed(staticSuite) &&
    ipcInventory.missingPreload.length === 0 &&
    ipcInventory.missingMain.length === 0 &&
    ipcInventory.orphanPreload.length === 0 &&
    ipcInventory.orphanMain.length === 0
  const conclusion =
    manifest.status === 'passed'
      ? `Within the validation scope described in this report, the VarLens web implementation produced equivalent normalized results for all ${stakeholderIpcAreas.length} stakeholder-facing IPC areas in the Electron Postgres vs Web Postgres harness and all manifest-backed desktop SQLite vs web Postgres domain data scenarios exercised by this run.`
      : manifest.status === 'incomplete'
        ? `Within the validation scope described in this report, the required harness completed, but exact IPC parity evidence is incomplete: ${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas are supported by matching result evidence.`
        : 'The validation evidence is not sufficient for release reassurance because at least one required validation suite did not complete successfully.'

  const lines = [
    '# VarLens Web Validation Report',
    '',
    `Validation result: ${status}`,
    '',
    `Run completed: ${manifest.finishedAt ?? 'not finished'}`,
    `Code version: ${manifest.git.branch ?? 'unknown'} @ ${manifest.git.sha ?? 'unknown'}${
      manifest.git.dirty ? ' (local changes present)' : ''
    }`,
    '',
    '## Abstract',
    '',
    manifest.status === 'passed'
      ? `This report evaluates whether the VarLens web implementation preserves desktop behavior for the covered clinical-variant workflows. The validation run executed static web checks, PostgreSQL-backed web checks, manifest-backed desktop SQLite to web Postgres data parity checks, and Electron Postgres vs Web Postgres result parity checks across ${stakeholderIpcAreas.length} stakeholder-facing IPC areas. All required suites completed successfully, with ${exactIpcParityCount} of ${stakeholderIpcAreas.length} IPC areas producing matching result fingerprints.`
      : manifest.status === 'incomplete'
        ? `This report evaluates whether the VarLens web implementation preserves desktop behavior for the covered clinical-variant workflows. The validation harness completed without required suite failures, but exact IPC result parity is only proven for ${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas.`
        : 'This report evaluates whether the VarLens web implementation preserves desktop behavior for the covered clinical-variant workflows. The validation run did not complete successfully; at least one required validation area needs review before this result should be used as release evidence.',
    '',
    `The run evaluated ${summary.tests} checks: ${summary.passed} passed, ${summary.failed} failed, and ${summary.skipped} were marked as non-blocking or not applicable by the harness. Hashes in this report are SHA-256 fingerprints of normalized result objects and are used as compact evidence, not as a replacement for the underlying equality assertions.`,
    '',
    '## Validation Scope',
    '',
    '| Boundary | Included In This Report | Rationale |',
    '| --- | --- | --- |'
  ]

  lines.push(
    `| Desktop baseline | Electron desktop application at ${manifest.git.sha ?? 'unknown'} | Desktop remains the reference implementation for local variant-analysis behavior. |`,
    '| Web target | Web server backed by PostgreSQL | This is the deployment mode whose behavior is being compared against the desktop baseline. |',
    `| IPC areas | ${stakeholderIpcAreas.length} stakeholder-facing areas | IPC means the typed bridge between renderer consumers and main-process/domain handlers. |`,
    `| Domain data fixtures | ${parityScenarios.length} manifest-backed fixture scenario(s) | Fixture inputs cover representative import/query workflows across supported data shapes. |`,
    '| External network APIs | Fixture-backed during parity validation | Network-dependent services are stabilized so parity tests compare application behavior instead of third-party availability. |',
    '| Release decision | Evidence for the covered validation scope only | This report does not claim exhaustive correctness for every possible user dataset or workflow. |',
    '',
    '## Methodology',
    '',
    'The validation run applies the same fixture inputs to desktop and web execution paths, captures the returned result objects, applies deterministic normalization for known runtime-specific fields, and compares the normalized objects directly. A SHA-256 fingerprint is then recorded for each compared result as compact evidence that can be reviewed in the report.',
    '',
    'The method separates three evidence classes: IPC surface wiring, Electron Postgres vs Web Postgres per-IPC result parity, and desktop SQLite vs web PostgreSQL domain data parity. Surface wiring confirms that a shared contract, preload binding, and main/web handler path exist. IPC parity confirms that representative operations for an IPC area return equivalent normalized results across the two Postgres runtimes. Domain data parity confirms that manifest-backed fixture imports and queries produce equivalent normalized outputs across desktop SQLite and web PostgreSQL.',
    '',
    '## Results Summary',
    '',
    '| Validation Area | Result | Interpretation |',
    '| --- | --- | --- |'
  )

  const dataSuites = ['web-data-gather', 'web-data-prepare', 'web-data-verify'].map((id) =>
    suiteById(manifest, id)
  )
  const dataPassed = dataSuites.every((suite) => suite !== undefined && suitePassed(suite))
  lines.push(
    `| Test data preparation | ${dataPassed ? 'Passed' : 'Needs attention'} | Fixture sources were gathered, transformed, and verified before application tests ran. |`
  )

  lines.push(
    `| IPC/API surface checks | ${suiteStatusLabel(staticSuite)} | ${suiteStatusSentence(
      staticSuite,
      `${stakeholderIpcAreas.length} stakeholder-facing IPC areas were inventoried separately from domain data parity.`,
      'Static web checks were not part of this run.',
      'IPC/API surface checks reported failures.'
    )} |`
  )

  const postgresSuite = suiteById(manifest, 'web-gate-postgres')
  lines.push(
    `| PostgreSQL-backed web behavior | ${suiteStatusLabel(postgresSuite)} | ${suiteStatusSentence(
      postgresSuite,
      'The web server ran against PostgreSQL and passed the required integration checks.',
      'PostgreSQL-backed checks were not run.',
      'PostgreSQL-backed web checks reported failures.'
    )} |`
  )

  lines.push(
    `| Desktop-to-web behavior parity | ${
      hasIpcParityGaps && suitePassed(paritySuite) ? 'Partial' : suiteStatusLabel(paritySuite)
    } | ${suiteStatusSentence(
      paritySuite,
      hasIpcParityGaps
        ? `Representative workflows matched, but exact parity is only proven for ${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas.`
        : 'Desktop and web behavior matched for the covered parity workflows.',
      'Behavior parity checks were not run.',
      'Desktop-to-web behavior parity reported failures.'
    )} |`
  )

  lines.push(
    `| Per-IPC exact parity | ${
      hasIpcParityGaps ? 'Incomplete' : 'Passed'
    } | ${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas have exact Electron Postgres/Web Postgres result parity evidence. |`
  )

  lines.push(
    `| Domain data parity | ${suiteStatusLabel(dataParitySuite)} | ${suiteStatusSentence(
      dataParitySuite,
      'Manifest-backed fixtures imported and queried consistently on desktop SQLite and web PostgreSQL, with normalized result hashes recorded for each scenario.',
      'Manifest-backed data parity was not run.',
      'Manifest-backed data parity reported failures.'
    )} |`
  )

  lines.push(
    '',
    '## IPC Traceability Matrix',
    '',
    'IPC in this report means the typed application bridge used by renderer consumers to call domain handlers. In the desktop application this crosses the Electron renderer/main boundary; in web validation, the same domain intent is exercised through the web dispatcher against PostgreSQL.',
    '',
    `${exactIpcParityCount} of ${stakeholderIpcAreas.length} stakeholder-facing IPC areas have exact Electron Postgres/Web Postgres result parity evidence in this run. Rows marked "Parity test needed" have their communication surface checked, but still need a domain-specific parity scenario before they should be treated as exact-result parity.`,
    '',
    '| IPC Area | Surface Wiring | Result Parity | Operations | Desktop Hash | Web Hash | Evidence |',
    '| --- | --- | --- | ---: | --- | --- | --- |'
  )

  for (const row of ipcParityMatrix) {
    lines.push(
      `| ${row.label} | ${row.surfacePassed ? 'Passed' : 'Needs attention'} | ${row.result} | ${row.operationCount} | ${shortHash(row.desktopHash)} | ${shortHash(row.webHash)} | ${row.evidence} |`
    )
  }

  lines.push(
    '',
    '### IPC Contract Inventory',
    '',
    '| IPC Surface | Expected From Shared Contract | Verified In This Run | Result |',
    '| --- | ---: | --- | --- |',
    `| Domain-module IPC contracts | ${ipcInventory.shared.length} | ${ipcInventory.shared.length} shared contract files inspected | ${ipcSurfacePassed ? 'Passed' : 'Needs attention'} |`,
    `| Preload IPC bindings | ${ipcInventory.shared.length} | ${ipcInventory.preload.length} present, ${ipcInventory.missingPreload.length} missing, ${ipcInventory.orphanPreload.length} orphaned | ${ipcInventory.missingPreload.length === 0 && ipcInventory.orphanPreload.length === 0 ? 'Passed' : 'Needs attention'} |`,
    `| Main-process IPC handlers | ${ipcInventory.shared.length} | ${ipcInventory.main.length} present, ${ipcInventory.missingMain.length} missing, ${ipcInventory.orphanMain.length} orphaned | ${ipcInventory.missingMain.length === 0 && ipcInventory.orphanMain.length === 0 ? 'Passed' : 'Needs attention'} |`,
    `| Flat legacy IPC handlers | ${flatIpcHandlers.length} | ${flatIpcHandlers.join(', ')} are tracked outside the domain-module count | Tracked separately |`,
    '',
    `Domain-module IPC names: ${ipcInventory.shared.join(', ')}.`,
    '',
    '## Domain Data Parity',
    ''
  )

  if (parityScenarios.length > 0) {
    lines.push(
      `${passedParityScenarios.length} of ${parityScenarios.length} manifest-backed scenarios passed. Desktop produced ${totalDesktopVariants} variants and web produced ${totalWebVariants} variants across the compared fixtures.`,
      `${matchedParityHashes.length} of ${parityScenarios.length} scenarios produced matching SHA-256 fingerprints over the normalized desktop and web results. The test also compares the normalized result objects directly; the hash is included here as compact review evidence.`,
      '',
      '| Fixture Set | Data Type / Mode | Result | Variant Match | Query Match | Result Fingerprint |',
      '| --- | --- | --- | --- | --- | --- |'
    )
    for (const scenario of parityScenarios) {
      const desktopVariants = scenario.desktop?.totalVariants ?? 0
      const webVariants = scenario.web?.totalVariants ?? 0
      const hashLabel =
        scenario.hashMatch === true
          ? `${shortHash(scenario.desktop?.resultHash)} matched`
          : scenario.hashMatch === false
            ? 'mismatch'
            : 'not available'
      lines.push(
        `| ${scenario.id} | ${scenario.importMode ?? 'unknown'} | ${scenario.status} | ${desktopVariants}/${webVariants} | ${queryMatchSummary(
          scenario
        )} | ${hashLabel} |`
      )
    }
  } else {
    lines.push('No manifest-backed data parity report was produced for this run.')
  }

  lines.push(
    '',
    '## Limitations',
    '',
    '- The conclusion is bounded by the fixture scenarios and IPC operations exercised in this run; it does not prove equivalence for every possible user dataset.',
    '- Result fingerprints are computed after deterministic normalization of runtime-specific fields such as generated identifiers, timestamps, file paths, and environment-specific connection labels.',
    '- Network-backed resources are fixture-backed during parity validation so the comparison remains deterministic and independent of external service availability.',
    '- The report distinguishes communication-surface coverage from exact result parity. A surface check alone is not treated as proof of equivalent behavior.',
    '- Skipped checks are counted as non-blocking or not applicable only when the harness marks them that way; required-suite skips still fail or incomplete the report.',
    '',
    '## Conclusion',
    '',
    conclusion,
    '',
    '## Evidence Package',
    '',
    'The handoff package is intentionally compact. It keeps the stakeholder PDF, the technical summary, and per-suite logs:',
    '',
    `- Technical summary: \`${relative(resolve(latestDir, 'summary.md'))}\``,
    `- PDF validation report: \`${relative(resolve(latestDir, 'stakeholder-report.pdf'))}\``,
    `- Test data evidence: \`${relative(resolve(latestDir, 'test-data'))}\``,
    `- Per-suite logs: \`${relative(resolve(latestDir, 'logs'))}\``,
    `- Data parity detail: \`${relative(resolve(latestDir, 'parity/latest.md'))}\``,
    '',
    '## Run Notes',
    ''
  )

  if (failedSuites.length === 0) {
    lines.push('- No required validation suite failed.')
  } else {
    lines.push(
      `- ${failedSuites.length} required validation suite${failedSuites.length === 1 ? '' : 's'} failed and need review.`
    )
  }

  if (nonBlockingSkipped > 0) {
    lines.push(
      `- ${nonBlockingSkipped} checks were skipped by the harness as non-blocking or not applicable for this run.`
    )
  }

  return `${lines.join('\n')}\n`
}

import { writeStakeholderPdf } from './web-report-pdf.mjs'

export { buildReportAssessment, renderStakeholderReport, renderSummary, writeStakeholderPdf }
