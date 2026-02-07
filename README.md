# VarLens

[![Build](https://github.com/berntpopp/VarLens/actions/workflows/build.yml/badge.svg)](https://github.com/berntpopp/VarLens/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F.svg)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D.svg)](https://vuejs.org/)

Offline desktop application for genetic variant analysis, built for clinical genomics workflows.

## Overview

VarLens provides a data-dense interface for importing, filtering, and analyzing annotated variant data without requiring an internet connection. It stores case data in local SQLite databases with optional encryption and supports cross-platform use on Windows, macOS, and Linux.

### Key capabilities

- Import annotated variant JSON files (single, batch, or ZIP archive)
- Filter and search variants by gene, consequence, population frequency, pathogenicity scores, and more
- Full-text search across gene symbols, consequences, and annotations (SQLite FTS5)
- Cohort analysis across multiple cases
- HPO-based phenotype matching and similarity scoring
- Export results to Excel and CSV
- Optional database encryption (SQLCipher)
- Multi-database management with quick switching

### Supported annotations

VarLens works with JSON exports containing SNV/indel annotations including gnomAD population frequencies, CADD and REVEL scores, ClinVar classifications, SpliceAI predictions, and HPO phenotype terms.

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3, Vuetify 3 (Material Design), TypeScript |
| Desktop | Electron, electron-vite |
| Database | SQLite via better-sqlite3-multiple-ciphers |
| State | Pinia |
| Testing | Vitest, happy-dom |
| CI/CD | GitHub Actions (Windows, macOS, Linux) |

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- npm 9 or later
- **Windows only:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload (required for native module compilation)

## Getting started

```bash
# Install dependencies (automatically rebuilds native modules for Electron)
npm install

# Start development server with hot reload
make dev
```

## Development

```bash
make dev              # Rebuild native modules + start dev server
make lint             # Lint with auto-fix
make typecheck        # TypeScript type checking
make rebuild-node     # Rebuild native modules for Node.js (required before tests)
make test             # Run test suite
make ci               # Lint + typecheck + test (mirrors CI pipeline)
```

### Building

```bash
make dist             # Build and package for current platform
make dist-linux       # Linux (AppImage, deb)
make dist-mac         # macOS (DMG, ZIP)
make dist-win         # Windows (NSIS installer, portable, ZIP)
```

### Native modules

This project uses `better-sqlite3-multiple-ciphers`, a native C++ addon that must be compiled separately for Node.js (tests) and Electron (app). The Makefile handles this automatically. See [CLAUDE.md](CLAUDE.md) for details on the dual-mode rebuild workflow.

## Project structure

```
src/
  main/           Electron main process, SQLite database, IPC handlers
  preload/        Context bridge exposing typed IPC API
  renderer/       Vue 3 SPA (components, composables, stores)
  shared/types/   Shared TypeScript type definitions
tests/            Vitest test suite
docs/             Additional documentation
```

## Code signing

Windows installers are signed via [SignPath Foundation](https://signpath.org). See [docs/CODE-SIGNING.md](docs/CODE-SIGNING.md) for the full policy.

## License

[MIT](LICENSE) -- Labor Berlin
