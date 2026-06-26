# Brand assets & favicons

How the VarLens logo is used for the browser favicon, PWA/app icons, and the
web login wall. **The logo artwork is never redrawn here** — every asset is the
existing logo, only *resized and reformatted* to fit each surface.

## Source of truth

`src/renderer/public/favicon.svg` is the canonical logo (the DNA-helix-in-a-lens
mark). The identical artwork also lives at `resources/icon.svg` (desktop app
icon) and `docs/public/logo.svg` (docs/marketing). All favicon raster assets are
derived from `favicon.svg`; if the logo changes, regenerate (below).

## The set (modern minimal)

Following the current best-practice "few files, not twenty" approach
([Evil Martians — How to Favicon](https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs),
[Favicon best practices 2025](https://iconmaker.studio/blog/favicon-best-practices-2025)):

| File | Size | Purpose |
|---|---|---|
| `favicon.svg` | scalable | Modern-browser tab icon (the logo itself) |
| `favicon.ico` | 16/32/48 | Legacy tabs, Google results |
| `apple-touch-icon.png` | 180×180 | iOS home screen (opaque white tile, padded) |
| `icon-192.png` | 192×192 | Android home screen (transparent) |
| `icon-512.png` | 512×512 | PWA splash (transparent) |
| `icon-maskable-512.png` | 512×512 | Android adaptive icon (maskable, 80% safe zone) |
| `manifest.webmanifest` | — | PWA metadata + icon list |

All live in `src/renderer/public/` and are copied to the served root by Vite
(web build → `out/web/public/`, desktop renderer build alike).

### Head wiring (`src/renderer/index.html`)

```html
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#1E3A5F" />
```

Notes: iOS/maskable tiles must be opaque (the logo has dark ink), so they sit on
a white tile with padding; the manifest icon `src`s are relative so they resolve
under the app's URL prefix (`APP_PATH_PREFIX`).

## Login wall logo

The standalone login page (`src/web/login/login.html`) shows the logo with
`<img src="…/favicon.svg">`. The page gate (`src/web/server/page-gate.ts`)
302-redirects every anonymous request except `/healthz` and `/login`, so the
favicon assets are added to its `PUBLIC_ROOT_ASSETS` allowlist — they are the
non-sensitive public logo, so they load for unauthenticated visitors (the login
tab favicon + this `<img>`). No inlining: the logo stays a single source file.

## Regenerating

Requires `rsvg-convert` (librsvg), `magick` (ImageMagick), `icotool` (icoutils).

```bash
# Favicon / app-icon raster set from src/renderer/public/favicon.svg
bash scripts/brand/build-favicons.sh
```

This only resizes/reformats the existing logo; it never edits the paths.
