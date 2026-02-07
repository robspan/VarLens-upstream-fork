# Varlens

> Your lens into genetic variants

**Varlens** is an Electron-based desktop application for offline analysis of genetic variant data.

## Features

- **Offline-first**: Full functionality without internet connection
- **Familiar UX**: Data-dense interface optimized for clinical genomics workflows
- **High performance**: SQLite + FTS5 for efficient querying of large datasets
- **Cross-platform**: Windows, macOS, and Linux support

## Tech Stack

- **Frontend**: Vue 3, Vuetify 3, TypeScript
- **Desktop**: Electron with electron-vite
- **Database**: SQLite (better-sqlite3) with FTS5 full-text search
- **Testing**: Vitest + Playwright

## Project Status

🚧 **In Development**

## Data Format

Varlens imports JSON files containing annotated variant data with support for:
- SNV/Indel annotations
- Population frequencies (gnomAD)
- Pathogenicity predictions (CADD, REVEL, ClinVar)
- Phenotype matching (HPO terms)

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## License

[MIT](LICENSE) - Labor Berlin
