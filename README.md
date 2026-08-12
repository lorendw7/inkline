# Inkline

[![Deploy to GitHub Pages](https://github.com/lorendw7/inkline/actions/workflows/deploy.yml/badge.svg)](https://github.com/lorendw7/inkline/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-lorendw7.github.io%2Finkline-black)](https://lorendw7.github.io/inkline/)

A browser-based PDF signing tool. Open a PDF, draw your signature, drag and resize it into position, and export a signed PDF — entirely client-side. No server, no upload of your documents, and none of the color-rendering bugs that iOS Markup is known for.

**Live: [lorendw7.github.io/inkline](https://lorendw7.github.io/inkline/)**

## Features

- **Open a PDF** and preview every page in the browser
- **Draw a signature** on a canvas pad — saved as a transparent PNG
- **Place it anywhere**, on any page, as many times as you like — drag to move, resize to scale, delete with the × button
- **Export** a new PDF with the signature drawn into the page, downloaded as `<name>-signed.pdf`
- **100% client-side** — your document never leaves your machine

## How to use

1. **Open PDF** — pick a file. Nothing is uploaded anywhere; the file is read straight into the page.
2. **Sign** — draw your signature in the modal and confirm. The first copy lands on the page you are looking at.
3. **Place on this page** — drops another copy of the same signature on the current page. Drag it, grab a corner to resize it, or hover it and hit × to remove it.
4. **Export** — downloads the signed PDF. The document's own text stays text: the signature is added as an image, the page is never flattened to a picture.

Known limits: pages with a `/Rotate` value other than 0 are not repositioned
correctly yet, and encrypted PDFs cannot be opened at all.

## Tech Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | React 19 + Vite | Lightweight SPA; no SSR needed for a single-page tool |
| Language | TypeScript | |
| PDF rendering | [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Renders PDF pages to `<canvas>` for preview and placement |
| PDF composition | [pdf-lib](https://pdf-lib.js.org/) | Embeds the signature image at exact coordinates and exports a new PDF, fully in-browser |
| Signature pad | [signature_pad](https://github.com/szimek/signature_pad) | Mature, lightweight canvas drawing library |
| Drag / resize | [react-rnd](https://github.com/bokuweb/react-rnd) | Free-form move + resize of the signature overlay |
| Styling | Tailwind CSS v4 | Utility-first, wired via the `@tailwindcss/vite` plugin |
| Linting | Oxlint | Ships with the Vite template |
| Deployment | GitHub Pages | Static site, zero cost, published by Actions on every push to `main` |

## Getting Started

```bash
npm install
npm run dev
```

Then open the printed localhost URL.

Other scripts: `npm run build` (type-check + production build), `npm run lint`, `npm run preview`.

## Deployment

Pushing to `main` builds the site and publishes it to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Because the site
is served from a repository subpath, `vite.config.ts` sets `base: '/inkline/'` —
without it every asset URL would 404. The build output is never committed.

That subpath has two consequences worth knowing. Vite rewrites root-relative
URLs it can see — in `index.html` and in CSS — so `/inkline.svg` ships as
`/inkline/inkline.svg`; a path written inside a JS string is invisible to it and
has to be built from `import.meta.env.BASE_URL`. And the icon must be declared
explicitly, because a browser's implicit `/favicon.ico` request goes to the
domain root, which under Pages belongs to the account, not to this repository.

## Project Status

- [x] **Milestone 0 — Scaffold**: Vite + React + TypeScript + Tailwind v4, all core libraries installed
- [x] **Milestone 1 — PDF rendering**: load a file and render every page to canvas with pdf.js, at device pixel density
- [x] **Milestone 2 — Signature pad**: draw a transparent-PNG signature in a modal
- [x] **Milestone 3 — Placement**: drag, resize and delete signature overlays with react-rnd, on any page and any number of times
- [x] **Milestone 4 — Export**: compose and download the signed PDF with pdf-lib (unrotated pages only — see [Architecture Notes](docs/ARCHITECTURE.md))
- [ ] **Milestone 5 — Polish** (in progress): site identity — icon, page title
      and link-preview metadata — is done; still to come are error and empty
      states, an in-app guide for first-time visitors, loading feedback during
      export, keyboard shortcuts (`Delete`, `Esc`), and a layout that survives a
      phone screen

Deployment came early, out of milestone order — the site has been live on GitHub
Pages since Milestone 1, so every step since has been verified in production
rather than only on localhost.

See the [Development Guide](docs/GUIDE.md) for what each milestone involves.

## Project Structure

```text
index.html                   # The real entry point: <head> metadata and the mount node
public/                      # Copied verbatim to the site root — icons only
src/
  App.tsx                    # All state (pdf doc, original bytes, signature, placements) and the header
  components/
    PdfPage.tsx              # One page on one canvas; hosts that page's overlays as children
    SignaturePadModal.tsx    # Modal with the signature_pad drawing surface
  hooks/
    useVisiblePage.ts        # Which page the reader is looking at, via IntersectionObserver
    useDevicePixelRatio.ts   # Tracks devicePixelRatio so pages redraw on a monitor change
  lib/
    pdf.ts                   # pdf.js: load, display scale, render a page
    export.ts                # pdf-lib: embed the signature and save new bytes
    coords.ts                # CSS pixels (top-left) <-> PDF points (bottom-left)
    image.ts                 # Natural size of a data URL, for the aspect ratio
    types.ts                 # Placement — the shape both the overlay and the export read
```

There is no Toolbar or SignatureOverlay component: the header is small enough to
live in `App.tsx`, and a placement is a `<Rnd>` rendered inline as a child of its
page. The split that matters is not view-versus-view but the one in
[Architecture Notes](docs/ARCHITECTURE.md) — pdf.js only displays, pdf-lib only
composes, and `Placement[]` is the plain data both sides agree on.

## Documentation

- [Development Guide](docs/GUIDE.md) — step-by-step milestones for building the tool
- [Architecture Notes](docs/ARCHITECTURE.md) — coordinate systems, data flow, and the tricky parts

## Roadmap (post-MVP)

- Upload an existing signature PNG instead of drawing one — a `FileReader.readAsDataURL` away, since everything downstream already speaks data URLs
- Rotated-page support (`/Rotate` 90/180/270), which needs the placement remapped per case and `rotate:` passed to `drawImage`
- Multiple signatures / initials / date stamps
- Saved signature library (localStorage)
- Multi-party signing and cloud archive (would require a small Node/Express backend + object storage such as S3/R2 — deliberately out of scope for the MVP)

## License

MIT — see [LICENSE](LICENSE).
