# Agent Health Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast, baseline-aware agent-health command that prevents new oversized source files, preserves Claude/Codex context hygiene, and documents the guardrail in the normal VarLens command surface.

**Architecture:** Implement one Node ESM CLI script in `scripts/check-agent-health.mjs`, backed by fixture-style Vitest CLI tests under `tests/scripts/`. The script scans authored files, compares oversized files against a committed JSON baseline, fails only on source regressions, and reports existing oversized files without forcing immediate refactors.

**Tech Stack:** Node 24 ESM, Vitest, npm scripts, Makefile, Markdown, JSON.

---

## File Map

- Create `scripts/check-agent-health.mjs`: CLI and pure helper functions for line counting, path classification, ignore handling, baseline comparison, and report rendering.
- Create `scripts/agent-health-baseline.json`: current approved oversized-file baseline with reasons.
- Create `tests/scripts/agent-health.test.ts`: CLI-level fixture tests using `spawnSync`, temporary directories, and synthetic files.
- Create `.aiexclude`: Claude/Codex context hygiene exclusions aligned with `.gitignore`.
- Create `.github/pull_request_template.md`: minimal PR checklist because the repository currently has no PR template.
- Modify `package.json`: add `agent:check`.
- Modify `Makefile`: add `agent-check` target and `.PHONY` entry.
- Modify `AGENTS.md`: add the command and baseline policy.

## Task 1: Add Failing Agent-Health CLI Tests

**Files:**
- Create: `tests/scripts/agent-health.test.ts`

- [ ] **Step 1: Create the test file with fixture helpers and failing expectations**

Create `tests/scripts/agent-health.test.ts`:

```ts
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check-agent-health.mjs')

const tempRoots: string[] = []

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'varlens-agent-health-'))
  tempRoots.push(root)
  return root
}

function writeLines(root: string, relativePath: string, lineCount: number): void {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  const lines = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`)
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf8')
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function runAgentCheck(root: string, extraArgs: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      '--root',
      root,
      '--baseline',
      'scripts/agent-health-baseline.json',
      '--source-threshold',
      '10',
      '--test-threshold',
      '12',
      ...extraArgs
    ],
    {
      cwd: root,
      encoding: 'utf8'
    }
  )
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('check-agent-health', () => {
  it('passes when authored files stay under thresholds', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/small.ts', 5)
    writeLines(root, 'scripts/small-tool.mjs', 6)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Agent health check passed')
    expect(result.stdout).toContain('Source threshold: 10')
    expect(result.stderr).toBe('')
  })

  it('fails when a new source file exceeds the threshold', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/too-large.ts', 11)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('New oversized source files')
    expect(result.stdout).toContain('src/main/too-large.ts')
  })

  it('fails when a baseline source file grows', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/baseline.ts', 14)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/baseline.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Baseline oversized files that grew')
    expect(result.stdout).toContain('src/main/baseline.ts')
    expect(result.stdout).toContain('13 -> 14')
  })

  it('passes when a baseline source file is unchanged or smaller', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/baseline.ts', 12)
    writeJson(root, 'scripts/agent-health-baseline.json', {
      version: 1,
      files: [
        {
          path: 'src/main/baseline.ts',
          lines: 13,
          threshold: 10,
          category: 'source',
          reason: 'existing oversized source module'
        }
      ]
    })

    const result = runAgentCheck(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Existing oversized files unchanged or improved')
    expect(result.stdout).toContain('13 -> 12')
  })

  it('reports oversized tests without failing phase 1', () => {
    const root = createTempRepo()
    writeLines(root, 'tests/main/large.test.ts', 13)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Oversized test files reported only')
    expect(result.stdout).toContain('tests/main/large.test.ts')
  })

  it('ignores generated, fixture, migration, build, and cache paths', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/database/migrations.ts', 40)
    writeLines(root, 'src/renderer/src/mocks/fixtures/variants.ts', 40)
    writeLines(root, 'src/generated/schema.ts', 40)
    writeLines(root, 'out/main/index.js', 40)
    writeLines(root, '.planning/artifacts/perf/result.ts', 40)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Agent health check passed')
    expect(result.stdout).not.toContain('migrations.ts')
    expect(result.stdout).not.toContain('fixtures/variants.ts')
  })

  it('returns usage error when the baseline is malformed', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/small.ts', 5)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts/agent-health-baseline.json'), '{', 'utf8')

    const result = runAgentCheck(root)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Failed to read baseline')
  })

  it('can print the current oversized-file inventory as JSON', () => {
    const root = createTempRepo()
    writeLines(root, 'src/main/too-large.ts', 11)
    writeJson(root, 'scripts/agent-health-baseline.json', { version: 1, files: [] })

    const result = runAgentCheck(root, ['--print-current-json'])

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.files).toEqual([
      {
        path: 'src/main/too-large.ts',
        lines: 11,
        threshold: 10,
        category: 'source',
        reason: 'current oversized source file'
      }
    ])
  })

  it('prints valid committed baseline JSON for the real repository', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--print-current-json', '--baseline', 'scripts/agent-health-baseline.json'],
      {
        cwd: process.cwd(),
        encoding: 'utf8'
      }
    )

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.version).toBe(1)
    expect(parsed.files.some((entry: { path: string }) => entry.path === 'src/preload/index.ts')).toBe(
      true
    )
  })
})
```

- [ ] **Step 2: Run the new tests and verify they fail because the script does not exist**

Run:

```bash
npx vitest run tests/scripts/agent-health.test.ts
```

Expected: FAIL with spawn results returning a Node module-not-found error for `scripts/check-agent-health.mjs`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/scripts/agent-health.test.ts
git commit -m "test: add agent health guardrail coverage"
```

## Task 2: Implement the Agent-Health Script

**Files:**
- Create: `scripts/check-agent-health.mjs`

- [ ] **Step 1: Create the script with CLI parsing, scanning, comparison, and output**

Create `scripts/check-agent-health.mjs`:

```js
#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_SOURCE_THRESHOLD = 600
const DEFAULT_TEST_THRESHOLD = 800
const DEFAULT_BASELINE = 'scripts/agent-health-baseline.json'
const VERSION = 1

const authoredExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.vue'])
const alwaysIgnoredSegments = new Set([
  '.git',
  '.cache',
  'node_modules',
  'out',
  'dist',
  'release',
  'coverage',
  'test-results',
  'playwright-report',
  'playwright-output'
])

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    baseline: DEFAULT_BASELINE,
    sourceThreshold: DEFAULT_SOURCE_THRESHOLD,
    testThreshold: DEFAULT_TEST_THRESHOLD,
    printCurrentJson: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--root') {
      if (!next) throw new Error('--root requires a value')
      options.root = next
      index += 1
    } else if (arg === '--baseline') {
      if (!next) throw new Error('--baseline requires a value')
      options.baseline = next
      index += 1
    } else if (arg === '--source-threshold') {
      if (!next) throw new Error('--source-threshold requires a value')
      options.sourceThreshold = parsePositiveInteger(next, '--source-threshold')
      index += 1
    } else if (arg === '--test-threshold') {
      if (!next) throw new Error('--test-threshold requires a value')
      options.testThreshold = parsePositiveInteger(next, '--test-threshold')
      index += 1
    } else if (arg === '--print-current-json') {
      options.printCurrentJson = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return {
    ...options,
    root: resolve(options.root),
    baseline: resolve(options.root, options.baseline)
  }
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function printHelp() {
  console.log(`Usage: node scripts/check-agent-health.mjs [options]

Options:
  --root <path>                 Repository root. Defaults to cwd.
  --baseline <path>             Baseline path relative to root.
  --source-threshold <number>   Authored source threshold. Defaults to 600.
  --test-threshold <number>     Test reporting threshold. Defaults to 800.
  --print-current-json          Print current oversized inventory and exit 0.
`)
}

function toRelative(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join('/')
}

function extensionOf(path) {
  const match = path.match(/(\.[^.]+)$/u)
  return match ? match[1] : ''
}

function shouldSkipDirectory(relativePath) {
  if (!relativePath) return false
  const segments = relativePath.split('/')
  if (segments.some((segment) => alwaysIgnoredSegments.has(segment))) return true
  if (relativePath === '.planning/artifacts' || relativePath.startsWith('.planning/artifacts/')) {
    return true
  }
  return false
}

function isIgnoredFile(relativePath) {
  if (relativePath.endsWith('.d.ts')) return true
  if (relativePath.endsWith('.snap')) return true
  if (relativePath.endsWith('package-lock.json')) return true
  if (relativePath.includes('/__snapshots__/')) return true
  if (relativePath.includes('/fixtures/') || relativePath.includes('/mocks/fixtures/')) return true
  if (relativePath.includes('/database/migrations.')) return true
  if (relativePath.includes('/migrations/')) return true
  if (relativePath.startsWith('src/generated/')) return true
  if (relativePath.startsWith('src/renderer/public/')) return true
  return false
}

function classifyFile(relativePath) {
  if (relativePath.startsWith('tests/')) return 'test'
  if (relativePath.startsWith('src/') || relativePath.startsWith('scripts/')) return 'source'
  return 'other'
}

function collectFiles(root) {
  const files = []

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name)
      const relativePath = toRelative(root, absolutePath)

      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(relativePath)) walk(absolutePath)
        continue
      }

      if (!entry.isFile()) continue
      if (!authoredExtensions.has(extensionOf(relativePath))) continue
      if (isIgnoredFile(relativePath)) continue

      const category = classifyFile(relativePath)
      if (category === 'other') continue

      files.push({
        path: relativePath,
        absolutePath,
        category
      })
    }
  }

  walk(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function countLines(path) {
  const content = readFileSync(path, 'utf8')
  if (content.length === 0) return 0
  const lineBreaks = content.match(/\n/gu)?.length ?? 0
  return content.endsWith('\n') ? lineBreaks : lineBreaks + 1
}

function thresholdFor(category, options) {
  return category === 'test' ? options.testThreshold : options.sourceThreshold
}

function buildCurrentInventory(root, options) {
  return collectFiles(root)
    .map((file) => {
      const lines = countLines(file.absolutePath)
      const threshold = thresholdFor(file.category, options)
      return {
        path: file.path,
        lines,
        threshold,
        category: file.category,
        reason:
          file.category === 'test'
            ? 'current oversized test file'
            : 'current oversized source file'
      }
    })
    .filter((entry) => entry.lines > entry.threshold)
    .sort((a, b) => a.path.localeCompare(b.path))
}

function readBaseline(path) {
  if (!existsSync(path)) {
    return { version: VERSION, files: [] }
  }

  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read baseline ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (parsed.version !== VERSION || !Array.isArray(parsed.files)) {
    throw new Error(`Invalid baseline ${path}: expected { "version": 1, "files": [...] }`)
  }

  return parsed
}

function compareToBaseline(current, baseline) {
  const baselineByPath = new Map(baseline.files.map((entry) => [entry.path, entry]))
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]))
  const newOversizedSource = []
  const grownBaselineSource = []
  const unchangedOrImproved = []
  const oversizedTests = []

  for (const entry of current) {
    const baselineEntry = baselineByPath.get(entry.path)

    if (entry.category === 'test') {
      oversizedTests.push(entry)
      continue
    }

    if (!baselineEntry) {
      newOversizedSource.push(entry)
      continue
    }

    if (entry.lines > baselineEntry.lines) {
      grownBaselineSource.push({ baseline: baselineEntry, current: entry })
    } else {
      unchangedOrImproved.push({ baseline: baselineEntry, current: entry })
    }
  }

  for (const baselineEntry of baseline.files) {
    if (baselineEntry.category === 'source' && !currentByPath.has(baselineEntry.path)) {
      unchangedOrImproved.push({ baseline: baselineEntry, current: null })
    }
  }

  return {
    newOversizedSource,
    grownBaselineSource,
    unchangedOrImproved,
    oversizedTests,
    failed: newOversizedSource.length > 0 || grownBaselineSource.length > 0
  }
}

function renderEntry(entry) {
  return `  - ${entry.path}: ${entry.lines} lines (threshold ${entry.threshold})`
}

function renderComparison(entry) {
  const currentLines = entry.current ? entry.current.lines : 0
  return `  - ${entry.baseline.path}: ${entry.baseline.lines} -> ${currentLines} lines`
}

function renderReport(options, comparison) {
  const lines = [
    'Agent health check',
    `Source threshold: ${options.sourceThreshold}`,
    `Test threshold: ${options.testThreshold}`
  ]

  if (comparison.newOversizedSource.length > 0) {
    lines.push('', 'New oversized source files')
    lines.push(...comparison.newOversizedSource.map(renderEntry))
  }

  if (comparison.grownBaselineSource.length > 0) {
    lines.push('', 'Baseline oversized files that grew')
    lines.push(...comparison.grownBaselineSource.map(renderComparison))
  }

  if (comparison.unchangedOrImproved.length > 0) {
    lines.push('', 'Existing oversized files unchanged or improved')
    lines.push(...comparison.unchangedOrImproved.map(renderComparison))
  }

  if (comparison.oversizedTests.length > 0) {
    lines.push('', 'Oversized test files reported only')
    lines.push(...comparison.oversizedTests.map(renderEntry))
  }

  if (!comparison.failed) {
    lines.push('', 'Agent health check passed')
  } else {
    lines.push('', 'Agent health check failed')
  }

  return `${lines.join('\n')}\n`
}

export function run(options) {
  if (!existsSync(options.root) || !statSync(options.root).isDirectory()) {
    throw new Error(`Root does not exist or is not a directory: ${options.root}`)
  }

  const current = buildCurrentInventory(options.root, options)
  if (options.printCurrentJson) {
    return {
      status: 0,
      stdout: `${JSON.stringify({ version: VERSION, files: current }, null, 2)}\n`,
      stderr: ''
    }
  }

  const baseline = readBaseline(options.baseline)
  const comparison = compareToBaseline(current, baseline)
  return {
    status: comparison.failed ? 1 : 0,
    stdout: renderReport(options, comparison),
    stderr: ''
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = run(options)
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npx vitest run tests/scripts/agent-health.test.ts
```

Expected: all tests except the real-repository baseline test may still fail because the committed baseline file does not exist yet. The fixture tests for CLI behavior should now pass.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/check-agent-health.mjs
git commit -m "chore: add agent health check script"
```

## Task 3: Add the Initial Baseline

**Files:**
- Create: `scripts/agent-health-baseline.json`

- [ ] **Step 1: Generate current oversized source inventory**

Run:

```bash
node scripts/check-agent-health.mjs --print-current-json > /tmp/agent-health-baseline.json
```

Expected: `/tmp/agent-health-baseline.json` contains JSON with `version: 1` and current oversized source/test entries.

- [ ] **Step 2: Create the committed baseline from current source entries**

Copy `/tmp/agent-health-baseline.json` to `scripts/agent-health-baseline.json`, then edit the reasons so source entries explain why they are temporarily grandfathered.

Use this policy:

```json
{
  "version": 1,
  "files": [
    {
      "path": "src/preload/index.ts",
      "lines": 796,
      "threshold": 600,
      "category": "source",
      "reason": "existing legacy preload surface; must not grow before domain extraction"
    }
  ]
}
```

Keep all generated, fixture, migration, and test entries out of the committed baseline unless the script reports them as blocking source entries.

- [ ] **Step 3: Run the focused test again**

Run:

```bash
npx vitest run tests/scripts/agent-health.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the actual agent-health command**

Run:

```bash
node scripts/check-agent-health.mjs
```

Expected: exit `0`, with a report that includes `Agent health check passed` plus current unchanged or improved oversized baseline files.

- [ ] **Step 5: Commit the baseline**

```bash
git add scripts/agent-health-baseline.json
git commit -m "chore: baseline agent health inventory"
```

## Task 4: Wire the Command Surface

**Files:**
- Modify: `package.json`
- Modify: `Makefile`

- [ ] **Step 1: Add the npm script**

In `package.json`, add `agent:check` inside `"scripts"` near the existing lint and format scripts:

```json
"agent:check": "node scripts/check-agent-health.mjs",
```

- [ ] **Step 2: Add the Makefile target**

In `Makefile`, add `agent-check` to the `.PHONY` line.

Add this target in the Code Quality section:

```make
agent-check: ## Check LLM-sustainable source size and context guardrails
	npm run agent:check
```

Do not add `agent-check` to `ci` in this first rollout.

- [ ] **Step 3: Run command-surface verification**

Run:

```bash
npm run agent:check
make agent-check
```

Expected: both commands exit `0` and print `Agent health check passed`.

- [ ] **Step 4: Commit command wiring**

```bash
git add package.json Makefile
git commit -m "chore: wire agent health command"
```

## Task 5: Add Context Hygiene and PR Checklist

**Files:**
- Create: `.aiexclude`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Add `.aiexclude`**

Create `.aiexclude`:

```gitignore
# Dependencies and build output
node_modules/
out/
dist/
release/

# Tool caches and generated reports
.cache/
.eslintcache
.prettiercache
coverage/
test-results/
playwright-report/
playwright-output/
.playwright-mcp/

# Local databases, logs, and temporary files
*.db
*.db-journal
*.log
tmp/
temp/
*.tmp

# Local environment files
.env
.env.local
.env.*.local

# Large local or generated planning artifacts
.planning/artifacts/perf/
tests/.cache/

# Sensitive or very large genomic/clinical data
test-data/
plan/
*.json.gz
*.vcf
*.vcf.gz
*.bam
*.sam
*.cram
*.bed
*.fastq
*.fq
*.fastq.gz
*.fq.gz
*.ped

# Public vendor bundles copied from dependencies
src/renderer/public/pdbe-molstar-component.js
src/renderer/public/pdbe-molstar-light.css
```

- [ ] **Step 2: Add a minimal PR template**

Create `.github/pull_request_template.md`:

```markdown
## Summary

-

## Verification

-

## Agent Health

- [ ] `make agent-check` was run, or this PR only changes files outside the guardrail scope.
- [ ] Any touched source file over 600 LOC did not grow, or the PR explains why the growth is necessary.
- [ ] Behavior-boundary tests were added or updated where the change affects parser, IPC, storage, import/export, classification, or filtering behavior.
- [ ] This PR avoids unrelated refactors.
```

- [ ] **Step 3: Run formatting check for Markdown/config changes**

Run:

```bash
npm run format:check -- .aiexclude .github/pull_request_template.md
```

Expected: PASS or Prettier reports these files are ignored/not matched. If Prettier requires changes, run:

```bash
npm run format -- .github/pull_request_template.md
```

- [ ] **Step 4: Commit context and PR hygiene files**

```bash
git add .aiexclude .github/pull_request_template.md
git commit -m "docs: add agent context and review hygiene"
```

## Task 6: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add `make agent-check` to Canonical Commands**

In the Canonical Commands table, add:

```markdown
| `make agent-check`                                                | Check LLM-sustainable source size and context guardrails                   |
```

- [ ] **Step 2: Add the baseline policy to LLM-Sustainable Development**

In the `LLM-Sustainable Development` section, add one bullet after the file-size bullet:

```markdown
- **Run `make agent-check` before PRs that touch authored source structure.** Existing oversized files are tracked in `scripts/agent-health-baseline.json`; they must not grow unless the PR explains why the added code cannot be split safely.
```

- [ ] **Step 3: Run documentation verification**

Run:

```bash
git diff --check
npm run agent:check
```

Expected: `git diff --check` exits `0`; `npm run agent:check` exits `0`.

- [ ] **Step 4: Commit AGENTS update**

```bash
git add AGENTS.md
git commit -m "docs: document agent health guardrail"
```

## Task 7: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused agent-health test suite**

Run:

```bash
npx vitest run tests/scripts/agent-health.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint check**

Run:

```bash
make lint-check
```

Expected: PASS.

- [ ] **Step 3: Run agent health through the Makefile**

Run:

```bash
make agent-check
```

Expected: PASS with `Agent health check passed`.

- [ ] **Step 4: Run format check**

Run:

```bash
make format-check
```

Expected: PASS.

- [ ] **Step 5: Check for verification-only formatting adjustments**

Run:

```bash
git status --short
```

Expected: no unexpected modified files. If formatting changed a file from this plan, inspect the diff and commit only that file with `style: format agent health guardrails`.

## Self-Review Checklist

- Spec goal "measurable agent-health command" is covered by Tasks 1-4.
- Spec goal "line-count baseline" is covered by Task 3.
- Spec goal "context exclusions" is covered by Task 5.
- Spec goal "PR review prompts" is covered by Task 5.
- Spec goal "AGENTS.md stays lean" is covered by Task 6.
- Spec non-goal "do not wire into `make ci` yet" is honored in Task 4.
- Function-size enforcement is intentionally deferred, matching the spec.
- Test files are report-only in Phase 1, matching the recommended rollout.
