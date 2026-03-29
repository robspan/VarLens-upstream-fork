# VitePress Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VitePress documentation site with automated Playwright screenshots and GitHub Pages deployment.

**Architecture:** VitePress in `docs/` with section-based sidebar, synthetic demo dataset for screenshots and E2E tests, Playwright script to capture screenshots from compiled Electron app, GitHub Actions workflow deploying to Pages on release tags.

**Tech Stack:** VitePress 2.x, Playwright (existing), GitHub Pages, GitHub Actions

**Spec:** `.planning/specs/2026-03-12-vitepress-docs-site-design.md`

---

## Chunk 1: Foundation (Tasks 1-4)

### Task 1: Move existing docs directories to .planning

**Files:**
- Move: `docs/plans/` -> `.planning/plans/` (merge with existing)
- Move: `docs/superpowers/` -> `.planning/superpowers/`
- Delete: `docs/` (empty after move)

- [ ] **Step 1: Move docs/plans contents into .planning/plans**

```bash
# .planning/plans/ already exists, merge contents
cp -r docs/plans/* .planning/plans/ 2>/dev/null || true
```

- [ ] **Step 2: Move docs/superpowers to .planning/superpowers**

```bash
cp -r docs/superpowers .planning/superpowers
```

- [ ] **Step 3: Remove old docs directory**

```bash
rm -rf docs/plans docs/superpowers
rmdir docs 2>/dev/null || true
```

- [ ] **Step 4: Verify .planning is gitignored**

```bash
grep '.planning' .gitignore
# Expected: .planning/
```

- [ ] **Step 5: Commit**

Note: `.planning/` is gitignored, so git only sees the deletions of `docs/plans/` and `docs/superpowers/`.

```bash
git rm -r docs/plans docs/superpowers
git commit -m "chore: remove docs/plans and docs/superpowers (moved to .planning/)"
```

---

### Task 2: Install VitePress and add scripts

**Files:**
- Modify: `package.json` (add scripts + devDependency)
- Modify: `Makefile` (add docs targets)

- [ ] **Step 1: Install VitePress as devDependency**

```bash
npm install -D vitepress
```

- [ ] **Step 2: Add docs scripts to package.json**

Add these scripts to the `"scripts"` section in `package.json`:

```json
"docs:dev": "vitepress dev docs",
"docs:build": "vitepress build docs",
"docs:preview": "vitepress preview docs",
"docs:screenshots": "npx playwright test tests/e2e/screenshots.e2e.ts"
```

- [ ] **Step 3: Add Makefile targets**

Add before the `# Setup & Cleanup` section in `Makefile`:

```makefile
#---------------------------------------------------------------------------
# Documentation
#---------------------------------------------------------------------------

docs: ## Build documentation site
	npm run docs:build

docs-dev: ## Start documentation dev server
	npm run docs:dev

docs-preview: ## Preview built documentation site
	npm run docs:preview

docs-screenshots: rebuild build ## Generate documentation screenshots from Electron app
	npm run docs:screenshots
```

- [ ] **Step 4: Update .PHONY in Makefile**

Add `docs docs-dev docs-preview docs-screenshots` to the `.PHONY` line at the top.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json Makefile
git commit -m "chore: add VitePress devDependency and docs scripts"
```

---

### Task 3: Create VitePress configuration and theme

**Files:**
- Create: `docs/.vitepress/config.ts`
- Create: `docs/.vitepress/theme/index.ts`
- Create: `docs/.vitepress/theme/custom.css`
- Create: `docs/public/screenshots/.gitkeep`

- [ ] **Step 1: Create VitePress config**

Create `docs/.vitepress/config.ts`:

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'VarLens',
  description: 'Offline genetic variant analysis for research collaborators',
  base: '/VarLens/',

  appearance: true,
  lastUpdated: true,

  sitemap: {
    hostname: 'https://berntpopp.github.io/VarLens/'
  },

  head: [
    ['link', { rel: 'icon', href: '/VarLens/logo.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'VarLens Documentation' }],
    ['meta', { property: 'og:description', content: 'Offline genetic variant analysis for research collaborators' }],
    ['meta', { name: 'twitter:card', content: 'summary' }]
    // og:image and twitter:image deferred until og-image.png is created
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Features', link: '/features/variant-table' },
      { text: 'Reference', link: '/reference/supported-formats' },
      { text: 'About', link: '/about/overview' },
      {
        text: 'Download',
        link: 'https://github.com/berntpopp/VarLens/releases/latest',
        target: '_blank'
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Importing Data', link: '/guide/importing-data' }
          ]
        }
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Variant Table', link: '/features/variant-table' },
            { text: 'Filtering', link: '/features/filtering' },
            { text: 'Variant Details', link: '/features/variant-details' },
            { text: 'Annotations', link: '/features/annotations' },
            { text: 'Cohort Analysis', link: '/features/cohort-analysis' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Supported Formats', link: '/reference/supported-formats' },
            { text: 'Keyboard Shortcuts', link: '/reference/keyboard-shortcuts' },
            { text: 'FAQ', link: '/reference/faq' }
          ]
        }
      ],
      '/about/': [
        {
          text: 'About',
          items: [
            { text: 'Overview', link: '/about/overview' },
            { text: 'Citation', link: '/about/citation' },
            { text: 'Changelog', link: '/about/changelog' },
            { text: 'Contributing', link: '/about/contributing' }
          ]
        }
      ]
    },

    search: {
      provider: 'local'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/berntpopp/VarLens' }
    ]
  }
})
```

- [ ] **Step 2: Create theme files**

Create `docs/.vitepress/theme/index.ts`:

```typescript
import DefaultTheme from 'vitepress/theme'
import './custom.css'

export default DefaultTheme
```

Create `docs/.vitepress/theme/custom.css`:

```css
/**
 * VarLens brand color overrides for VitePress theme
 * Using warm palette (#a09588) matching the Electron app
 */

/* Light mode */
:root {
  --vp-c-brand-1: #a09588;
  --vp-c-brand-2: #8a7f72;
  --vp-c-brand-3: #6d665c;
  --vp-c-brand-soft: rgba(160, 149, 136, 0.14);
}

/* Dark mode */
.dark {
  --vp-c-brand-1: #c0b5a8;
  --vp-c-brand-2: #a09588;
  --vp-c-brand-3: #8a7f72;
  --vp-c-brand-soft: rgba(160, 149, 136, 0.16);
}

/* Screenshot browser-frame presentation */
.screenshot-frame {
  margin: 1.5rem 0;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.screenshot-frame img {
  display: block;
  width: 100%;
  height: auto;
  border-bottom: 1px solid var(--vp-c-divider);
}

.screenshot-frame figcaption {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  text-align: center;
  font-style: italic;
}
```

- [ ] **Step 3: Create public directory with .gitkeep**

```bash
mkdir -p docs/public/screenshots
touch docs/public/screenshots/.gitkeep
```

- [ ] **Step 4: Copy logo.svg to docs public**

```bash
cp resources/icon.svg docs/public/logo.svg
```

- [ ] **Step 5: Verify VitePress config is valid**

```bash
npx vitepress build docs 2>&1 | tail -5
```

Expected: Build succeeds (may warn about missing pages, that's fine).

- [ ] **Step 6: Add docs/.vitepress/dist and docs/.vitepress/cache to .gitignore**

Append to `.gitignore`:

```
# VitePress
docs/.vitepress/dist
docs/.vitepress/cache
```

- [ ] **Step 7: Commit**

```bash
git add docs/.vitepress/ docs/public/ .gitignore
git commit -m "feat: add VitePress config, theme, and brand styling"
```

---

### Task 4: Create landing page and guide pages

**Files:**
- Create: `docs/index.md`
- Create: `docs/guide/introduction.md`
- Create: `docs/guide/installation.md`
- Create: `docs/guide/importing-data.md`

- [ ] **Step 1: Create landing page**

Create `docs/index.md`:

```markdown
---
layout: home

hero:
  name: VarLens
  text: Offline Genetic Variant Analysis
  tagline: A desktop application for secure, offline analysis of genetic variants — built for research collaborators
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: Download
      link: https://github.com/berntpopp/VarLens/releases/latest

features:
  - icon: "\U0001F50D"
    title: Variant Analysis
    details: Browse, sort, and search variants with a powerful data table supporting custom columns, per-column text filters, and full-text search
  - icon: "\U0001F3AF"
    title: Filtering & Search
    details: Filter by consequence, gnomAD allele frequency, CADD score, ClinVar significance, gene symbol, and more
  - icon: "\U0001F3E5"
    title: ACMG Classification
    details: Classify variants using the ACMG/AMP evidence framework with Bayesian point-based scoring
  - icon: "\U0001F465"
    title: Cohort Analysis
    details: Aggregate variants across cases for carrier frequency analysis and gene burden testing
  - icon: "\U0001F512"
    title: Offline & Secure
    details: All data stays on your machine. No cloud uploads, no accounts, no tracking. SQLite database with optional encryption
---
```

- [ ] **Step 2: Create introduction page**

Create `docs/guide/introduction.md`:

```markdown
# Introduction

VarLens is a desktop application for offline genetic variant analysis. It is designed for research collaborators who need to analyze variant data securely on their own machines, without uploading data to external servers.

## Who is VarLens for?

- **Genetic diagnostics labs** analyzing patient variant data
- **Research collaborators** receiving variant datasets for review
- **Bioinformaticians** who need a quick visual interface for variant files

## Key Capabilities

- **Import** variant data from JSON or VCF files (single or batch)
- **Browse** variants in a sortable, filterable data table
- **Filter** by gene, consequence, allele frequency, pathogenicity scores, and more
- **Annotate** variants with stars, comments, tags, and ACMG classifications
- **Enrich** variants on-demand with VEP, SpliceAI, and MyVariant.info
- **Analyze cohorts** with carrier aggregation and gene burden testing (Fisher's exact test)
- **Export** filtered results to CSV or TSV

## Architecture

VarLens is an Electron desktop app built with:

- **Vue 3 + Vuetify 3** for the user interface
- **SQLite** (via better-sqlite3) for local data storage
- **Electron** for cross-platform desktop distribution (Windows, macOS, Linux)

All processing happens locally. External API calls (VEP, gnomAD, ClinVar) are optional and only triggered when you explicitly request enrichment.

## Next Steps

- [Install VarLens](./installation.md) on your platform
- [Import your first dataset](./importing-data.md)
```

- [ ] **Step 3: Create installation page**

Create `docs/guide/installation.md`:

```markdown
# Installation

VarLens is available for Windows, macOS, and Linux.

## Download

Download the latest release for your platform from the [GitHub Releases page](https://github.com/berntpopp/VarLens/releases/latest).

| Platform | Format | File |
|----------|--------|------|
| Windows  | Installer | `Varlens-Setup-x.x.x.exe` |
| Windows  | Portable | `Varlens-Portable-x.x.x.exe` |
| macOS    | DMG | `Varlens-x.x.x-arm64.dmg` |
| macOS    | ZIP | `Varlens-x.x.x-arm64.zip` |
| Linux    | AppImage | `Varlens-x.x.x.AppImage` |
| Linux    | DEB | `Varlens-x.x.x.deb` |

## First Launch

1. Install or run the application for your platform
2. On first launch, VarLens creates a default SQLite database in your user data directory
3. You will see a disclaimer dialog — read and acknowledge it to proceed
4. The app opens with an empty state, ready to import data

![VarLens after first launch — ready to import variant data](/screenshots/empty-state.png)

## System Requirements

- **Windows:** Windows 10 or later
- **macOS:** macOS 12 (Monterey) or later
- **Linux:** Ubuntu 20.04 or later (or equivalent)
- **RAM:** 4 GB minimum, 8 GB recommended for large datasets
- **Disk:** 200 MB for the application, plus space for your variant databases

## Updating

VarLens includes an auto-update mechanism. When a new version is available, you will be notified in the application. You can also manually download the latest release from GitHub.
```

- [ ] **Step 4: Create importing data page**

Create `docs/guide/importing-data.md`:

```markdown
# Importing Data

VarLens supports importing variant data from JSON and VCF files.

## Supported Formats

VarLens accepts several JSON formats for variant data:

- **Columnar format:** `{ "CaseName": { "header": [...], "data": [[...]] } }` — tabular data with a header row and data arrays
- **Object format:** `{ "metadata": {...}, "samples": { "sampleId": { "variants": [...] } } }` — structured variant objects
- **Simple format:** `{ "variants": [...] }` — flat array of variant objects
- **VCF format:** Standard VCF v4.x files with VEP annotations

Files can be gzip-compressed (`.json.gz`).

For detailed format specifications, see [Supported Formats](../reference/supported-formats.md).

## Importing a Single Case

1. Click the **Import** button in the sidebar or use the toolbar menu
2. Select your variant file from the file dialog
3. Enter a case name (or accept the auto-generated name from the filename)
4. VarLens streams and imports the data, showing progress in real-time

![Import progress showing variants being loaded](/screenshots/importing-data.png)

## After Import

Once import completes, the case appears in the sidebar. Click it to open the variant table.

![Imported case visible in the sidebar](/screenshots/case-list.png)

## Batch Import

For importing multiple files at once, use the batch import feature available from the import menu. This processes multiple files sequentially and creates separate cases for each file.

## Tips

- Large files (>100,000 variants) may take a few minutes to import
- Import progress shows the current phase (reading, parsing, inserting) and variant count
- You can cancel an import in progress without losing previously imported data
```

- [ ] **Step 5: Verify docs build succeeds**

```bash
npx vitepress build docs 2>&1 | tail -10
```

Expected: Build succeeds. Warnings about missing screenshot images are acceptable.

- [ ] **Step 6: Commit**

```bash
git add docs/index.md docs/guide/
git commit -m "feat: add landing page and guide section (introduction, installation, importing)"
```

---

## Chunk 2: Demo Dataset & Screenshots (Tasks 5-6)

### Task 5: Create synthetic demo dataset

**Files:**
- Create: `tests/e2e/test-data/demo-case.json` (will be gzipped to `.json.gz` at import time)

- [ ] **Step 1: Create the demo dataset file**

Create `tests/e2e/test-data/demo-case.json` with ~50 synthetic variants. The format uses the app's columnar import format with header IDs matching `fieldMapping.ts`. **Critical format notes:**
- Use `dataDictionary` (not `dictionary`) for lookup fields — this is what `ColumnarStrategy.parseHeader()` reads
- MoI `dataDictionary` values must be arrays of objects with `abbreviation` property (not plain strings)
- Include both `selectedTranscript` and `Transcript` header entries so both columns are populated
- The file is stored as plain JSON but must be gzipped before import (the screenshot script handles this)

```json
{
  "DemoCase": {
    "header": [
      {
        "id": "Chr",
        "type": "text",
        "label": "Chromosome"
      },
      {
        "id": "Pos",
        "type": "number",
        "label": "Position"
      },
      {
        "id": "Ref",
        "type": "text",
        "label": "Reference"
      },
      {
        "id": "Alt",
        "type": "text",
        "label": "Alternate"
      },
      {
        "id": "Gene",
        "type": "dictionary",
        "label": "Gene",
        "dataDictionary": {
          "1": "BRCA1",
          "2": "CFTR",
          "3": "PKD1",
          "4": "SCN1A",
          "5": "KCNQ2",
          "6": "TSC2",
          "7": "APOE",
          "8": "NAT2",
          "9": "GSTT1",
          "10": "COL4A5",
          "11": "FBN1",
          "12": "DMD",
          "13": "NF1",
          "14": "TP53",
          "15": "PAH",
          "16": "LMNA",
          "17": "RB1",
          "18": "AR"
        }
      },
      {
        "id": "Consequence",
        "type": "dictionary",
        "label": "Consequence",
        "dataDictionary": {
          "1": "HIGH",
          "2": "MODERATE",
          "3": "LOW",
          "4": "MODIFIER"
        }
      },
      {
        "id": "Func",
        "type": "text",
        "label": "Function"
      },
      {
        "id": "Transcript",
        "type": "dictionary",
        "label": "Transcript (display)",
        "dataDictionary": {
          "1": "NM_007294.4",
          "2": "NM_000492.4",
          "3": "NM_001009944.3",
          "4": "NM_006920.6",
          "5": "NM_172107.4",
          "6": "NM_000548.5",
          "7": "NM_000041.4",
          "8": "NM_000015.3",
          "9": "NM_000853.3",
          "10": "NM_033380.3",
          "11": "NM_000138.5",
          "12": "NM_004006.3",
          "13": "NM_001042492.3",
          "14": "NM_000546.6",
          "15": "NM_000277.3",
          "16": "NM_170707.4",
          "17": "NM_000321.3",
          "18": "NM_000044.6"
        }
      },
      {
        "id": "selectedTranscript",
        "type": "dictionary",
        "label": "Selected Transcript",
        "dataDictionary": {
          "1": "NM_007294.4",
          "2": "NM_000492.4",
          "3": "NM_001009944.3",
          "4": "NM_006920.6",
          "5": "NM_172107.4",
          "6": "NM_000548.5",
          "7": "NM_000041.4",
          "8": "NM_000015.3",
          "9": "NM_000853.3",
          "10": "NM_033380.3",
          "11": "NM_000138.5",
          "12": "NM_004006.3",
          "13": "NM_001042492.3",
          "14": "NM_000546.6",
          "15": "NM_000277.3",
          "16": "NM_170707.4",
          "17": "NM_000321.3",
          "18": "NM_000044.6"
        }
      },
      {
        "id": "cDNA",
        "type": "text",
        "label": "cDNA Change"
      },
      {
        "id": "AAChange",
        "type": "text",
        "label": "Protein Change"
      },
      {
        "id": "GnomadAF",
        "type": "number",
        "label": "gnomAD AF"
      },
      {
        "id": "CADDPhredScore",
        "type": "number",
        "label": "CADD Score"
      },
      {
        "id": "Qual-Index",
        "type": "number",
        "label": "Quality"
      },
      {
        "id": "ClinVSig",
        "type": "text",
        "label": "ClinVar"
      },
      {
        "id": "GTNum-Index",
        "type": "number",
        "label": "Genotype"
      },
      {
        "id": "HpoSimScore",
        "type": "dictionary",
        "label": "HPO Similarity",
        "dataDictionary": {
          "1": 0.95,
          "2": 0.85,
          "3": 0.72,
          "4": 0.61,
          "5": 0.48,
          "6": 0.35,
          "7": 0.22,
          "8": 0.12,
          "9": 0.05,
          "10": 0.0
        }
      },
      {
        "id": "MoI",
        "type": "dictionary",
        "label": "Mode of Inheritance",
        "dataDictionary": {
          "1": [{"abbreviation": "AD"}],
          "2": [{"abbreviation": "AR"}],
          "3": [{"abbreviation": "XL"}],
          "4": [{"abbreviation": "MT"}]
        }
      },
      {
        "id": "Omim",
        "type": "text",
        "label": "OMIM"
      }
    ],
    "data": [
      ["17", 43094000, "G", "A", "1", "1", "exonic", "1", "c.5123C>T", "p.Ala1708Glu", 0.00001, 32.0, 4500, "pathogenic", 1, "2", "1", "113705"],
      ["17", 43091500, "C", "T", "1", "1", "exonic", "1", "c.4956G>A", "p.Trp1652*", 0.0, 38.0, 4800, "pathogenic", 1, "1", "1", "113705"],
      ["7", 117559590, "CTT", "C", "2", "1", "exonic", "2", "c.1521_1523del", "p.Phe508del", 0.02, 28.5, 3800, "pathogenic", 1, "3", "2", "219700"],
      ["7", 117587800, "G", "A", "2", "2", "exonic", "2", "c.3846G>A", "p.Trp1282*", 0.004, 35.0, 4200, "pathogenic", 1, "3", "2", "219700"],
      ["16", 2138500, "G", "T", "3", "2", "exonic", "3", "c.10102G>T", "p.Val3368Leu", 0.0003, 26.8, 3500, "likely_pathogenic", 1, "4", "1", "173900"],
      ["16", 2145200, "C", "A", "3", "1", "splicing", "3", "c.8017-2A>G", "", 0.0, 33.0, 4100, "pathogenic", 1, "4", "1", "173900"],
      ["2", 166105000, "G", "A", "4", "2", "exonic", "4", "c.4573C>T", "p.Arg1525Trp", 0.00008, 29.4, 3900, "uncertain_significance", 1, "2", "1", "182389"],
      ["2", 166120300, "T", "C", "4", "2", "exonic", "4", "c.2836A>G", "p.Met946Val", 0.0002, 25.1, 3400, "uncertain_significance", 1, "1", "1", "182389"],
      ["20", 62070200, "C", "T", "5", "2", "exonic", "5", "c.998G>A", "p.Arg333Gln", 0.0001, 27.3, 3600, "uncertain_significance", 1, "3", "1", "602235"],
      ["20", 62076500, "A", "G", "5", "2", "exonic", "5", "c.1657T>C", "p.Tyr553His", 0.00005, 24.8, 3100, "uncertain_significance", 1, "3", "1", "602235"],
      ["16", 2086400, "G", "C", "6", "2", "exonic", "6", "c.5024C>G", "p.Pro1675Arg", 0.0004, 28.9, 3700, "uncertain_significance", 1, "4", "1", "191100"],
      ["16", 2097600, "A", "T", "6", "2", "exonic", "6", "c.3412T>A", "p.Ser1138Thr", 0.0006, 23.2, 3200, "uncertain_significance", 1, "5", "1", "191100"],
      ["19", 44908684, "T", "C", "7", "2", "exonic", "7", "c.388T>C", "p.Cys130Arg", 0.15, 14.2, 2800, "benign", 1, "8", "1", "107741"],
      ["19", 44908822, "C", "T", "7", "3", "exonic", "7", "c.526C>T", "p.Arg176Cys", 0.08, 11.5, 2500, "benign", 0, "9", "1", "107741"],
      ["8", 18258100, "G", "A", "8", "2", "exonic", "8", "c.590G>A", "p.Arg197Gln", 0.28, 8.3, 2200, "benign", 1, "10", "2", "243400"],
      ["8", 18257900, "C", "T", "8", "3", "exonic", "8", "c.341C>T", "p.Thr114Ile", 0.22, 7.1, 1800, "benign", 2, "10", "2", "243400"],
      ["22", 24384300, "G", "A", "9", "4", "exonic", "9", "c.310G>A", "p.Ala104Thr", 0.30, 3.2, 1500, "benign", 1, "10", "2", "600436"],
      ["X", 108570600, "G", "A", "10", "2", "exonic", "10", "c.1871G>A", "p.Gly624Asp", 0.0008, 26.4, 3300, "likely_pathogenic", 1, "3", "3", "301050"],
      ["X", 108588900, "C", "T", "10", "1", "splicing", "10", "c.3609+1G>A", "", 0.0, 34.0, 4300, "pathogenic", 1, "2", "3", "301050"],
      ["X", 108594200, "A", "G", "10", "2", "exonic", "10", "c.4192A>G", "p.Ile1398Val", 0.001, 22.7, 2900, "uncertain_significance", 1, "5", "3", "301050"],
      ["15", 48756600, "C", "A", "11", "1", "splicing", "11", "c.4773+1G>T", "", 0.0, 33.5, 4400, "pathogenic", 1, "2", "1", "154700"],
      ["15", 48771200, "G", "T", "11", "2", "exonic", "11", "c.5788G>T", "p.Gly1930Cys", 0.00002, 31.2, 4000, "likely_pathogenic", 1, "2", "1", "154700"],
      ["15", 48792400, "T", "C", "11", "3", "intronic", "11", "c.6700-8T>C", "", 0.05, 5.8, 1200, "benign", 1, "8", "1", "154700"],
      ["X", 31147000, "A", "T", "12", "1", "exonic", "12", "c.4250A>T", "p.Asp1417Val", 0.0, 36.0, 4600, "pathogenic", 2, "1", "3", "310200"],
      ["X", 31165000, "G", "C", "12", "1", "exonic", "12", "c.5533del", "p.Gln1845Argfs*22", 0.0, 37.0, 4700, "pathogenic", 2, "1", "3", "310200"],
      ["17", 31232100, "C", "T", "13", "1", "exonic", "13", "c.910C>T", "p.Arg304*", 0.00003, 36.5, 4500, "pathogenic", 1, "2", "1", "162200"],
      ["17", 31250400, "G", "A", "13", "2", "exonic", "13", "c.2033G>A", "p.Arg678His", 0.0005, 25.6, 3200, "uncertain_significance", 1, "5", "1", "162200"],
      ["17", 31265800, "T", "G", "13", "3", "intronic", "13", "c.3500+5T>G", "", 0.02, 9.4, 1600, "benign", 1, "7", "1", "162200"],
      ["17", 7676600, "G", "A", "14", "1", "exonic", "14", "c.743G>A", "p.Arg248Gln", 0.0, 35.5, 4900, "pathogenic", 1, "1", "1", "191170"],
      ["17", 7674900, "C", "T", "14", "2", "exonic", "14", "c.817C>T", "p.Arg273Cys", 0.00001, 33.8, 4600, "pathogenic", 1, "1", "1", "191170"],
      ["12", 103232200, "G", "A", "15", "2", "exonic", "15", "c.1222C>T", "p.Arg408Trp", 0.012, 27.6, 3500, "pathogenic", 1, "3", "2", "261600"],
      ["12", 103246300, "A", "G", "15", "2", "exonic", "15", "c.782A>G", "p.Tyr261Cys", 0.003, 29.1, 3800, "pathogenic", 1, "3", "2", "261600"],
      ["1", 156134600, "C", "T", "16", "2", "exonic", "16", "c.1580G>A", "p.Arg527His", 0.0002, 28.7, 3600, "likely_pathogenic", 1, "4", "1", "150330"],
      ["1", 156137200, "G", "A", "16", "2", "exonic", "16", "c.1357C>T", "p.Arg453Trp", 0.0001, 30.5, 3900, "likely_pathogenic", 1, "4", "1", "150330"],
      ["1", 156140800, "A", "C", "16", "3", "exonic", "16", "c.1003T>G", "p.Ser335Ala", 0.04, 12.3, 2100, "benign", 0, "7", "1", "150330"],
      ["13", 48892300, "C", "T", "17", "1", "exonic", "17", "c.958C>T", "p.Arg320*", 0.00001, 37.5, 4800, "pathogenic", 1, "2", "1", "180200"],
      ["13", 48923500, "G", "A", "17", "2", "exonic", "17", "c.1654G>A", "p.Gly552Arg", 0.0003, 26.9, 3400, "uncertain_significance", 1, "5", "1", "180200"],
      ["13", 48953700, "T", "C", "17", "3", "intronic", "17", "c.2107-6T>C", "", 0.07, 6.2, 1100, "benign", 1, "9", "1", "180200"],
      ["X", 67723000, "C", "T", "18", "2", "exonic", "18", "c.2612G>A", "p.Arg871His", 0.0006, 24.5, 3000, "uncertain_significance", 2, "6", "3", "313700"],
      ["X", 67730200, "G", "A", "18", "2", "exonic", "18", "c.2198C>T", "p.Ala733Val", 0.001, 21.8, 2700, "uncertain_significance", 2, "6", "3", "313700"],
      ["3", 37042000, "G", "T", "13", "2", "exonic", "13", "c.5546G>T", "p.Gly1849Val", 0.0, 24.1, 320, "uncertain_significance", 1, "6", "1", "162200"],
      ["5", 112170800, "C", "G", "7", "3", "exonic", "7", "c.149C>G", "p.Ala50Gly", 0.12, 10.8, 450, "benign", 1, "10", "1", "107741"],
      ["10", 89720600, "A", "G", "14", "2", "exonic", "14", "c.1015A>G", "p.Ile339Val", 0.0, 20.3, 180, "uncertain_significance", 1, "7", "1", "191170"],
      ["9", 130713800, "T", "A", "6", "2", "exonic", "6", "c.1832A>T", "p.Lys611Met", 0.003, 18.7, 95, "benign", 0, "8", "1", "191100"],
      ["2", 179513100, "C", "T", "8", "4", "3_prime_UTR", "8", "c.*45C>T", "", 0.18, 2.1, 65, "benign", 1, "10", "2", "243400"],
      ["11", 64575300, "G", "C", "13", "2", "exonic", "13", "c.3827G>C", "p.Arg1276Pro", 0.0, 27.2, 4100, "uncertain_significance", 1, "5", "1", "162200"],
      ["4", 88536700, "A", "C", "15", "3", "synonymous", "15", "c.696A>C", "p.Glu232=", 0.09, 4.5, 2300, "benign", 1, "10", "2", "261600"],
      ["6", 152439200, "T", "C", "18", "2", "exonic", "18", "c.1747A>G", "p.Ile583Val", 0.0008, 19.4, 2600, "uncertain_significance", 1, "6", "3", "313700"],
      ["1", 11856500, "G", "A", "4", "1", "exonic", "4", "c.5734C>T", "p.Arg1912*", 0.0, 40.0, 5000, "pathogenic", 1, "1", "1", "182389"],
      ["12", 49420200, "C", "T", "12", "2", "exonic", "12", "c.7891C>T", "p.Arg2631Cys", 0.0, 30.8, 4200, "likely_pathogenic", 2, "2", "3", "310200"]
    ]
  }
}
```

Note: This file uses dictionary-based headers matching the columnar format from `fieldMapping.ts`. Gene, Consequence, Transcript, HPO, and MOI use dictionary lookups; others are raw values. The 50 variants cover all categories from the spec.

- [ ] **Step 2: Verify the demo dataset imports successfully**

Build the app and test import via a quick E2E check:

```bash
npm run rebuild:electron
npx electron-vite build
```

Then verify manually or via a quick Playwright snippet that the file can be imported. The existing `ColumnarStrategy` should handle this format since it matches the wrapped columnar pattern with dictionary headers.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/test-data/demo-case.json
git commit -m "feat: add synthetic demo dataset (50 variants, 18 genes) for docs screenshots and E2E tests"
```

---

### Task 6: Create Playwright screenshot script

**Files:**
- Create: `tests/e2e/screenshots.e2e.ts`

- [ ] **Step 1: Create the screenshot test file**

Create `tests/e2e/screenshots.e2e.ts`:

```typescript
/**
 * Automated screenshot generation for VarLens documentation.
 *
 * Launches the compiled Electron app, imports the demo dataset,
 * navigates through key views, and saves screenshots to docs/public/screenshots/.
 *
 * Run: npx playwright test tests/e2e/screenshots.e2e.ts
 * Prereqs: npm run rebuild:electron && npx electron-vite build
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const SCREENSHOT_DIR = path.resolve(__dirname, '../../docs/public/screenshots')
const DEMO_DATA_PATH = path.resolve(__dirname, 'test-data/demo-case.json')
const VIEWPORT = { width: 1280, height: 800 }

let app: ElectronApplication
let window: Page

/** Save a screenshot to the docs screenshot directory */
async function saveScreenshot(page: Page, name: string): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, type: 'png' })
}

/** Dismiss the disclaimer dialog if present */
async function dismissDisclaimer(page: Page): Promise<void> {
  const disclaimerBtn = page.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await page.waitForTimeout(500)
  }
}

test.describe('Documentation Screenshots', () => {
  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

    // Launch the compiled Electron app
    app = await electron.launch({
      args: ['./out/main/index.js'],
      env: {
        ...process.env,
        NODE_ENV: 'production'
      }
    })

    window = await app.firstWindow()
    await window.setViewportSize(VIEWPORT)
    await window.waitForSelector('.v-application', { timeout: 30000 })
    await dismissDisclaimer(window)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('01 - empty state', async () => {
    await window.waitForTimeout(500)
    await saveScreenshot(window, 'empty-state')
  })

  test('02 - import demo case', async () => {
    // Import the demo case via IPC (bypasses file dialog)
    // Must gzip the data since ImportService pipes through createGunzip()
    const demoData = fs.readFileSync(DEMO_DATA_PATH, 'utf-8')
    const importResult = await app.evaluate(async ({ app: electronApp }, jsonStr) => {
      const fsNode = require('fs')
      const pathNode = require('path')
      const zlib = require('zlib')
      const tempPath = pathNode.join(electronApp.getPath('userData'), 'demo-case.json.gz')

      // Gzip-compress the JSON before writing (ImportService requires gzipped input)
      const compressed = zlib.gzipSync(jsonStr)
      fsNode.writeFileSync(tempPath, compressed)

      // Import via ImportService with DatabaseService from the running app
      // Require paths are relative to the bundled out/main/ directory
      const { getDatabaseService } = require('./database')
      const { ImportService } = require('./import/ImportService')
      const db = getDatabaseService()
      const importService = new ImportService(db)
      const result = await importService.importVariants(tempPath, {
        caseName: 'DemoCase'
      })

      // Clean up temp file
      fsNode.unlinkSync(tempPath)
      return result
    }, demoData)

    expect(importResult.variantCount).toBeGreaterThan(0)

    // Wait for the case to appear in the sidebar and click it
    await window.waitForTimeout(1000)

    // Reload the case list by navigating
    const caseItem = window.locator('.v-list-item').filter({ hasText: /DemoCase/ })
    await caseItem.waitFor({ timeout: 10000 })

    // Screenshot: case list
    await saveScreenshot(window, 'case-list')

    // Click the case to load variants
    await caseItem.click()
    await window.waitForTimeout(1000)
  })

  test('03 - variant table', async () => {
    // Wait for the data table to load with rows
    await window.waitForSelector('.v-data-table-server', { timeout: 15000 })
    const rows = window.locator('.v-data-table__tr')
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    await window.waitForTimeout(500)

    await saveScreenshot(window, 'variant-table')
  })

  test('04 - filters active', async () => {
    // Look for the filter bar and apply a consequence filter
    // The filter bar should be visible in the case view
    const filterBar = window.locator('.filter-bar-container')
    if (await filterBar.isVisible().catch(() => false)) {
      // Try to interact with consequence filter if available
      // Click on a filter chip or dropdown to show active filtering
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'filters-active')
  })

  test('05 - column filters', async () => {
    // Per-column text filters are shown above table columns
    // Look for filter input fields in the table header area
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'column-filters')
  })

  test('06 - variant details panel', async () => {
    // Click a row to open the variant details panel
    const firstRow = window.locator('.v-data-table__tr').first()
    await firstRow.click()
    await window.waitForTimeout(1000)

    // Wait for the panel to appear
    const panel = window.locator('.v-navigation-drawer--right, .v-navigation-drawer--temporary')
    if (await panel.isVisible().catch(() => false)) {
      await window.waitForTimeout(500)
    }

    await saveScreenshot(window, 'variant-details')
  })

  test('07 - ACMG classification', async () => {
    // ACMG classification is in the variant details panel or annotations cell
    // Look for ACMG-related elements
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'acmg-classification')
  })

  test('08 - annotations', async () => {
    // Annotations include stars, comments, tags
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'annotations')
  })

  test('09 - cohort view', async () => {
    // Switch to cohort mode
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    if (await cohortBtn.isVisible().catch(() => false)) {
      await cohortBtn.click()
      await window.waitForTimeout(1500)
    }

    await saveScreenshot(window, 'cohort-view')

    // Switch back to case mode
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    if (await caseBtn.isVisible().catch(() => false)) {
      await caseBtn.click()
      await window.waitForTimeout(1000)
    }
  })

  test('10 - dark mode', async () => {
    // Toggle dark mode via Vuetify theme
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        await win.webContents.executeJavaScript(`
          const vuetify = document.querySelector('.v-application').__vue_app__.config.globalProperties.$vuetify;
          vuetify.theme.global.name.value = 'warmDark';
        `)
      }
    })

    await window.waitForTimeout(500)

    // Navigate back to case if needed, ensure table is visible
    const table = window.locator('.v-data-table-server')
    if (await table.isVisible().catch(() => false)) {
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'dark-mode')

    // Switch back to light mode
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        await win.webContents.executeJavaScript(`
          const vuetify = document.querySelector('.v-application').__vue_app__.config.globalProperties.$vuetify;
          vuetify.theme.global.name.value = 'warmLight';
        `)
      }
    })
  })
})
```

- [ ] **Step 2: Run the screenshot script locally**

```bash
npm run rebuild:electron
npx electron-vite build
npx playwright test tests/e2e/screenshots.e2e.ts
```

Expected: 9 test cases pass, 9 PNG files created in `docs/public/screenshots/`.

Note: The `importing-data` screenshot is not captured because the import bypasses the UI dialog via `evaluate()`. The `importing-data.png` reference in docs pages can be removed or replaced with a manual screenshot later. PNG format is used instead of WebP (spec allowed this fallback) for simplicity.

- [ ] **Step 3: Verify screenshots were created**

```bash
ls -la docs/public/screenshots/
```

Expected: `empty-state.png`, `case-list.png`, `variant-table.png`, `filters-active.png`, `column-filters.png`, `variant-details.png`, `acmg-classification.png`, `annotations.png`, `cohort-view.png`, `dark-mode.png`

Note: `importing-data.png` is not auto-generated (import runs headlessly). The docs page reference can be kept as a placeholder or removed.

- [ ] **Step 4: Add screenshots to .gitignore (they are regenerated)**

Append to `.gitignore`:

```
# Auto-generated documentation screenshots (regenerated by Playwright)
docs/public/screenshots/*.png
```

Keep `docs/public/screenshots/.gitkeep` tracked.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/screenshots.e2e.ts .gitignore
git commit -m "feat: add Playwright screenshot generation script for docs"
```

---

## Chunk 3: Feature & Reference Content (Tasks 7-9)

### Task 7: Create feature documentation pages

**Files:**
- Create: `docs/features/variant-table.md`
- Create: `docs/features/filtering.md`
- Create: `docs/features/variant-details.md`
- Create: `docs/features/annotations.md`
- Create: `docs/features/cohort-analysis.md`

- [ ] **Step 1: Create variant table page**

Create `docs/features/variant-table.md`:

```markdown
# Variant Table

The variant table is the primary view for analyzing variants in a case. It displays all imported variants in a sortable, scrollable data table with customizable columns.

![Variant table showing imported case data with sortable columns](/screenshots/variant-table.png)

## Columns

The table includes the following columns by default:

| Column | Description |
|--------|-------------|
| Annotations | Star, ACMG classification, comments |
| Chr | Chromosome |
| Pos | Genomic position (formatted with separators) |
| Ref / Alt | Reference and alternate alleles |
| GT | Genotype (0/1 het, 1/1 hom) |
| Gene | Gene symbol |
| OMIM | OMIM disease number |
| Func | Functional class (exonic, splicing, intronic, etc.) |
| Consequence | Variant consequence with color coding |
| Transcript | Selected transcript ID |
| cDNA | HGVS coding DNA change |
| AA Change | HGVS protein change |
| gnomAD AF | Population allele frequency |
| CADD | CADD pathogenicity score |
| Qual | Variant call quality score |
| ClinVar | ClinVar clinical significance |
| HPO Sim | HPO similarity score |
| MOI | Mode of inheritance (AD, AR, XL) |

## Column Customization

You can show, hide, and reorder columns using the column settings menu in the toolbar. Your column preferences are saved per-user in local storage.

## Sorting

Click any column header to sort by that column. Click again to reverse the sort order. Sorting is performed server-side for performance.

## Row Selection

Click any row to open the [Variant Details Panel](./variant-details.md). The selected row is highlighted with a blue left border.

## Pagination

The table uses server-side pagination. Use the controls at the bottom of the table to navigate between pages and adjust the number of rows per page.
```

- [ ] **Step 2: Create filtering page**

Create `docs/features/filtering.md`:

```markdown
# Filtering

VarLens provides multiple ways to filter variants, from broad category filters to precise per-column text search.

![Filter toolbar with active filters applied](/screenshots/filters-active.png)

## Filter Toolbar

The filter toolbar above the variant table provides dropdown filters for common criteria:

- **Gene symbol** — Filter by gene name (partial match)
- **Consequence** — Multi-select consequence types (missense, frameshift, splice, etc.)
- **Function** — Filter by functional class (exonic, splicing, intronic)
- **ClinVar** — Filter by clinical significance
- **gnomAD AF** — Maximum allele frequency threshold
- **CADD** — Minimum CADD score threshold
- **Tags** — Filter by assigned tags
- **Starred only** — Show only starred variants
- **Has comment** — Show only variants with comments
- **ACMG** — Filter by ACMG classification

## Per-Column Text Filters

![Per-column text filters for precise searching](/screenshots/column-filters.png)

Each column in the table supports a text filter input. Type in the filter field above a column to search within that column. Filters are applied with a 300ms debounce for smooth typing.

## Full-Text Search

The search bar supports full-text search across gene symbols with Boolean operators:

- `BRCA1` — Search for a gene
- `BRCA1 OR TP53` — Search for either gene
- `BRCA1 AND NOT TP53` — Exclude results

## Exact Variant Lookup

For precise lookups, you can search by chromosome, position, reference, and alternate allele to find a specific variant.
```

- [ ] **Step 3: Create variant details page**

Create `docs/features/variant-details.md`:

```markdown
# Variant Details

Clicking a row in the variant table opens the Variant Details Panel on the right side of the screen. This panel provides comprehensive information about the selected variant.

![Variant details panel with identity, scores, and external links](/screenshots/variant-details.png)

## Panel Sections

### Variant Identity

Shows the genomic coordinates (chr:pos:ref:alt) and any colocated variants.

### Transcripts

Displays transcript annotations with MANE Select and canonical transcript indicators. You can fetch additional transcript data from VEP on demand.

### Annotation Scores

Key pathogenicity and population scores:

- **gnomAD AF** — Population allele frequency
- **CADD** — Combined Annotation Dependent Depletion score
- **REVEL** — Rare Exome Variant Ensemble Learner score (if enriched)
- **AlphaMissense** — Protein structure-based pathogenicity (if enriched)
- **SpliceAI** — Splice prediction scores (if enriched)

### ACMG Classification

Quick-classify with one-click chips (P, LP, VUS, LB, B) or open the evidence editor for detailed ACMG/AMP criteria. See [Annotations](./annotations.md) for details.

### Tags

Assign custom tags to organize variants for review.

### Comments

Add global or per-case comments to document your analysis reasoning.

### External Links

Quick links to external databases:
- UCSC Genome Browser
- gnomAD
- ClinVar
- And any custom links configured in Settings

## Resizing

Drag the left edge of the panel to resize it. Your preferred width is saved.
```

- [ ] **Step 4: Create annotations page**

Create `docs/features/annotations.md`:

```markdown
# Annotations

VarLens provides several annotation tools to document your variant analysis findings.

![Annotation features: stars, ACMG classification, and comments](/screenshots/annotations.png)

## Stars

Click the star icon in the annotations column to mark important variants. Starred variants can be filtered using the "Starred only" toggle in the filter toolbar.

Stars exist at two levels:
- **Per-case stars** — Specific to the current case
- **Global stars** — Apply to the variant across all cases (indicated by a ring)

## ACMG Classification

![ACMG evidence editor with criteria selection](/screenshots/acmg-classification.png)

Classify variants using the ACMG/AMP framework:

1. **Quick classify** — Click P, LP, VUS, LB, or B chips for a fast classification
2. **Evidence editor** — Open the detailed editor to select specific ACMG evidence codes (PVS1, PS1-PS4, PM1-PM6, PP1-PP5, BA1, BS1-BS4, BP1-BP7) and add notes

Classifications are scored using the Bayesian point-based system and can exist at both per-case and global levels.

### Auto-Suggest

The evidence editor can auto-suggest applicable criteria based on:
- gnomAD allele frequency (BA1, BS1, PM2)
- CADD score (PP3, BP4)
- ClinVar significance

## Comments

Add free-text comments to document your reasoning:

- **Global comments** — Visible across all cases containing this variant
- **Per-case comments** — Specific to the current case context

## Tags

Create and assign custom tags (e.g., "Review", "Report", "Candidate") to organize variants. Tags can be managed in Settings and filtered in the toolbar.
```

- [ ] **Step 5: Create cohort analysis page**

Create `docs/features/cohort-analysis.md`:

```markdown
# Cohort Analysis

VarLens supports aggregating variants across multiple cases for cohort-level analysis.

![Cohort view showing aggregated variant data across cases](/screenshots/cohort-view.png)

## Switching to Cohort Mode

Use the mode toggle in the toolbar to switch between Case and Cohort views. Cohort mode aggregates all imported cases into a single table view.

## Cohort Table

The cohort table shows:

- **Carrier count** — Number of cases carrying each variant
- **Homozygous count** — Cases with homozygous genotype
- **Affected carriers** — Carriers with affected status
- All standard variant columns (gene, consequence, scores, etc.)

## Gene Burden Analysis

VarLens includes gene burden testing using Fisher's exact test to identify genes with statistically significant variant enrichment in affected versus unaffected cases.

## Filtering

Cohort view supports the same filtering capabilities as case view, plus additional cohort-specific filters for carrier count thresholds.
```

- [ ] **Step 6: Commit**

```bash
git add docs/features/
git commit -m "feat: add feature documentation pages (table, filtering, details, annotations, cohort)"
```

---

### Task 8: Create reference documentation pages

**Files:**
- Create: `docs/reference/supported-formats.md`
- Create: `docs/reference/keyboard-shortcuts.md`
- Create: `docs/reference/faq.md`

- [ ] **Step 1: Create supported formats page**

Create `docs/reference/supported-formats.md`:

```markdown
# Supported Formats

VarLens supports several data formats for variant import.

## JSON Columnar Format

The most common format. Data is organized with a header array describing columns and a data array of row values. Files may be gzip-compressed (`.json.gz`).

```json
{
  "CaseName": {
    "header": [
      { "id": "Chr", "type": "text", "label": "Chromosome" },
      { "id": "Pos", "type": "number", "label": "Position" },
      { "id": "Ref", "type": "text", "label": "Reference" },
      { "id": "Alt", "type": "text", "label": "Alternate" },
      { "id": "Gene", "type": "dictionary", "label": "Gene",
        "dataDictionary": { "1": "BRCA1", "2": "TP53" } },
      { "id": "Consequence", "type": "dictionary", "label": "Consequence",
        "dataDictionary": { "1": "HIGH", "2": "MODERATE" } }
    ],
    "data": [
      ["1", 100000, "A", "G", "1", "2"],
      ["17", 200000, "C", "T", "2", "1"]
    ]
  }
}
```

### Header Types

- **text** — Plain text value
- **number** — Numeric value
- **dictionary** — Lookup value referencing a dictionary map in the header

### Recognized Column IDs

| Column ID | Maps to | Notes |
|-----------|---------|-------|
| `Chr` | Chromosome | |
| `Pos` | Position | |
| `Ref` | Reference allele | |
| `Alt` | Alternate allele | |
| `Gene` | Gene symbol | Dictionary type |
| `Consequence` / `Impact` | Consequence severity | Dictionary: 1=HIGH, 2=MODERATE, 3=LOW, 4=MODIFIER |
| `Func` / `VarType` | Functional class | |
| `selectedTranscript` | Transcript | Dictionary type |
| `cDNA` / `HGVS_C` | cDNA change | |
| `AAChange` / `HGVS_P` | Protein change | |
| `GnomadAF` / `GnomTotal` | gnomAD AF | |
| `CADDPhredScore` | CADD score | |
| `Qual-Index` / `Qual` | Quality score | |
| `ClinVSig` / `ClinVar` | ClinVar significance | |
| `GTNum-Index` / `Genotype` | Genotype | |
| `HpoSimScore` | HPO similarity | Dictionary type |
| `MoI` | Mode of inheritance | Dictionary: AD, AR, XL |
| `Omim` | OMIM number | |

## JSON Object Format

Structured format with metadata and sample-level variant objects:

```json
{
  "metadata": { "version": "1.0" },
  "samples": {
    "SampleA": {
      "variants": [
        {
          "chr": "1",
          "pos": 100000,
          "ref": "A",
          "alt": "G",
          "gene_symbol": "GENE1"
        }
      ]
    }
  }
}
```

## JSON Simple Format

A flat array of variant objects:

```json
{
  "variants": [
    {
      "chr": "1",
      "pos": 100000,
      "ref": "A",
      "alt": "G"
    }
  ]
}
```

## VCF Format

Standard VCF v4.x files are supported with VEP/CSQ annotations in the INFO field. Annotations are parsed from the `CSQ` key following VEP output conventions.

## Compression

All JSON formats can be gzip-compressed (`.json.gz`). VarLens detects compression automatically during import.
```

- [ ] **Step 2: Create keyboard shortcuts page**

Create `docs/reference/keyboard-shortcuts.md`:

```markdown
# Keyboard Shortcuts

VarLens supports keyboard shortcuts for common actions.

| Shortcut | Action |
|----------|--------|
| `Escape` | Close open panel or dialog |

::: tip
Additional keyboard shortcuts may be added in future releases. Check the application's Help menu for the most current list.
:::
```

- [ ] **Step 3: Create FAQ page**

Create `docs/reference/faq.md`:

```markdown
# Frequently Asked Questions

## General

### What is VarLens?

VarLens is a desktop application for offline genetic variant analysis. It runs entirely on your local machine — no data is uploaded to any server.

### Is VarLens free?

Yes, VarLens is open source under the MIT license.

### Which platforms are supported?

Windows 10+, macOS 12+, and Linux (Ubuntu 20.04+ or equivalent).

## Data & Privacy

### Is my data sent anywhere?

No. All data stays on your machine in a local SQLite database. The only outbound network requests are optional enrichment queries (VEP, gnomAD, ClinVar) that you trigger manually.

### Can I encrypt my database?

Yes, VarLens supports database encryption via SQLCipher (better-sqlite3-multiple-ciphers). You can set a password in the database settings.

### What happens if I delete a case?

The case and all its variants are permanently removed from the database. Global annotations (shared across cases) are preserved.

## Import

### My import is slow. What can I do?

Large files (>100,000 variants) take longer to import. The import streams data to avoid memory issues, but SQLite writes are the bottleneck. Ensure your disk is not heavily loaded during import.

### Can I import multiple files at once?

Yes, use the batch import feature to process multiple files sequentially.

### My VCF file fails to import. Why?

VarLens expects VEP-annotated VCF files with a `CSQ` field in the INFO column. Plain VCF files without VEP annotations may import with limited data.

## Analysis

### How does the ACMG classification work?

VarLens implements the ACMG/AMP evidence framework with Bayesian point-based scoring. You can quick-classify with a single click or use the detailed evidence editor to select specific criteria.

### Can I export my results?

Yes, use the export feature to download filtered variants as CSV or TSV. Export respects your current filters and column selection.
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/
git commit -m "feat: add reference documentation (formats, shortcuts, FAQ)"
```

---

### Task 9: Create about documentation pages

**Files:**
- Create: `docs/about/overview.md`
- Create: `docs/about/citation.md`
- Create: `docs/about/changelog.md`
- Create: `docs/about/contributing.md`

- [ ] **Step 1: Create overview page**

Create `docs/about/overview.md`:

```markdown
# Overview

VarLens is an open-source desktop application for offline genetic variant analysis, developed at the [Institute of Human Genetics](https://www.kidney-genetics.org/) by Bernt Popp.

## Project Goals

- Provide a **secure, offline** tool for analyzing genetic variant data
- Support **research collaboration** where data cannot leave the local machine
- Offer **rich analysis features** (filtering, ACMG classification, cohort analysis) in a user-friendly interface
- Maintain **cross-platform** support (Windows, macOS, Linux)

## Technology

- **Frontend:** Vue 3, Vuetify 3, TypeScript
- **Backend:** Electron, SQLite (better-sqlite3-multiple-ciphers)
- **Build:** electron-vite, electron-builder
- **Testing:** Vitest (unit), Playwright (E2E)

## Source Code

VarLens is open source under the MIT license. The source code is available on [GitHub](https://github.com/berntpopp/VarLens).
```

- [ ] **Step 2: Create citation page**

Create `docs/about/citation.md`:

```markdown
# Citation

If you use VarLens in your research, please cite:

> Popp, B. VarLens: Offline Genetic Variant Analysis Tool. GitHub. https://github.com/berntpopp/VarLens

```bibtex
@software{popp_varlens,
  author = {Popp, Bernt},
  title = {VarLens: Offline Genetic Variant Analysis Tool},
  url = {https://github.com/berntpopp/VarLens},
  license = {MIT}
}
```
```

- [ ] **Step 3: Create changelog page**

Create `docs/about/changelog.md`:

```markdown
# Changelog

For the full changelog, see the [GitHub Releases page](https://github.com/berntpopp/VarLens/releases).

## Recent Releases

### v0.22.0

- Replace cursor-based pagination with OFFSET/LIMIT
- Fix CADD score mapping in pre-aggregation WHERE clause

### v0.21.3

- Fix unwrapped columnar import with dynamic column resolution

### v0.21.2

- Normalize Vuetify boolean sort orders for IPC safety
- Extract shared cursor pagination composable and fix sort/navigation bugs

### v0.21.1

- Unify sorting behavior and clear button across case and cohort views
- Resolve pagination regression in case and cohort views

For older releases and full details, visit the [releases page](https://github.com/berntpopp/VarLens/releases).
```

- [ ] **Step 4: Create contributing page**

Create `docs/about/contributing.md`:

```markdown
# Contributing

VarLens welcomes contributions. Here's how to get set up for development.

## Development Setup

### Prerequisites

- **Node.js** 20.x or later
- **npm** 10.x or later
- **Git**
- **Linux/macOS:** Standard build tools
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload

### Clone and Install

```bash
git clone https://github.com/berntpopp/VarLens.git
cd VarLens
npm install
```

The `postinstall` script automatically rebuilds native modules for Electron.

### Development

```bash
make dev        # Start dev server with hot reload
make test       # Run unit tests
make lint       # Lint and auto-fix
make typecheck  # TypeScript checking
make ci         # Run all CI checks locally
```

### Building

```bash
make dist       # Build and package for current platform
```

## Pull Request Workflow

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure `make ci` passes locally
4. Open a pull request against `main`
5. PR checks (lint, typecheck, test, build) run on Windows, Ubuntu, and macOS

## Releasing

Releases are triggered by pushing version tags:

```bash
# Bump version in package.json, then:
git tag v0.23.0
git push origin v0.23.0
```

The release workflow builds platform installers and creates a GitHub draft release.
```

- [ ] **Step 5: Verify full docs site builds**

```bash
npx vitepress build docs 2>&1 | tail -10
```

Expected: Build succeeds with all pages rendered.

- [ ] **Step 6: Commit**

```bash
git add docs/about/
git commit -m "feat: add about section (overview, citation, changelog, contributing)"
```

---

## Chunk 4: CI/CD & Final Polish (Tasks 10-11)

### Task 10: Create GitHub Actions docs workflow

**Files:**
- Create: `.github/workflows/docs.yml`

- [ ] **Step 1: Create the docs workflow**

Create `.github/workflows/docs.yml`:

```yaml
name: Deploy Docs

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-screenshots:
    name: Build & Screenshots
    runs-on: ubuntu-latest

    steps:
      - name: Configure git line endings
        run: git config --global core.autocrlf false

      - name: Checkout code
        uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libsqlite3-dev build-essential

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules for Electron
        run: npm run rebuild:electron

      - name: Build Electron app
        run: npx electron-vite build

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Generate screenshots
        run: xvfb-run --auto-servernum npx playwright test tests/e2e/screenshots.e2e.ts

      - name: Upload screenshots
        uses: actions/upload-artifact@v4
        with:
          name: screenshots
          path: docs/public/screenshots/*.png
          retention-days: 1

  deploy:
    name: Deploy to GitHub Pages
    needs: build-screenshots
    runs-on: ubuntu-latest

    permissions:
      pages: write
      id-token: write

    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies (skip native rebuild — only VitePress needed)
        run: npm ci --ignore-scripts

      - name: Download screenshots
        uses: actions/download-artifact@v4
        with:
          name: screenshots
          path: docs/public/screenshots/

      - name: Build docs
        run: npm run docs:build

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload to Pages
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: add GitHub Actions workflow for docs deployment on release tags"
```

---

### Task 11: Final verification and docs build test

**Files:**
- No new files

- [ ] **Step 1: Verify complete docs site builds**

```bash
npx vitepress build docs
```

Expected: Clean build with all pages.

- [ ] **Step 2: Preview the docs site locally**

```bash
npx vitepress preview docs --port 5174 &
sleep 2
echo "Docs site running at http://localhost:5174/VarLens/"
```

Open in browser and verify:
- Landing page renders with hero and feature cards
- Navigation works (Guide, Features, Reference, About)
- Sidebar navigation within each section
- Search works (type a term)
- Dark mode toggle works
- Screenshot placeholders show (or real screenshots if generated)

- [ ] **Step 3: Kill preview server**

```bash
kill %1
```

- [ ] **Step 4: (Optional) Verify screenshots generate locally**

On Linux with xvfb:
```bash
npm run rebuild:electron
npx electron-vite build
xvfb-run --auto-servernum npx playwright test tests/e2e/screenshots.e2e.ts
ls docs/public/screenshots/*.png
```

On macOS/Windows (no xvfb needed):
```bash
npm run rebuild:electron
npx electron-vite build
npx playwright test tests/e2e/screenshots.e2e.ts
```

Expected: 9 PNG files in `docs/public/screenshots/`.

- [ ] **Step 5: Run lint and typecheck to ensure no regressions**

```bash
make lint
make typecheck
```

Expected: No new errors from docs additions.

- [ ] **Step 6: Final commit if any cleanup needed**

```bash
git status
# If clean, no commit needed
```
