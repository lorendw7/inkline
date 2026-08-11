# Inkline

A browser-based PDF signing tool. Upload a PDF, draw or upload your signature, drag and resize it into position, and export a flattened, signed PDF — entirely client-side. No server, no upload of your documents, and none of the color-rendering bugs that iOS Markup is known for.

**Live: [lorendw7.github.io/inkline](https://lorendw7.github.io/inkline/)**

## Features (MVP)

- **Upload a PDF** and preview every page in the browser
- **Draw a signature** on a canvas pad (or upload a PNG with transparency)
- **Place the signature** anywhere on any page — drag to move, resize to scale
- **Export** a new PDF with the signature flattened in, downloaded locally
- **100% client-side** — your document never leaves your machine

## Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | React 19 + Vite | Lightweight SPA; no SSR needed for a single-page tool |
| Language | TypeScript | |
| PDF rendering | [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Renders PDF pages to `<canvas>` for preview and placement |
| PDF composition | [pdf-lib](https://pdf-lib.js.org/) | Embeds the signature image at exact coordinates and exports a new PDF, fully in-browser |
| Signature pad | [signature_pad](https://github.com/szimek/signature_pad) | Mature, lightweight canvas drawing library |
| Drag / resize | [react-rnd](https://github.com/bokuweb/react-rnd) | Free-form move + resize of the signature overlay |
| Styling | Tailwind CSS v4 | Utility-first, wired via the `@tailwindcss/vite` plugin |
| Linting | Oxlint | Ships with the Vite template |
| Deployment | Vercel / GitHub Pages | Static site, zero cost |

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

## Project Status

- [x] **Milestone 0 — Scaffold**: Vite + React + TypeScript + Tailwind v4, all core libraries installed
- [x] **Milestone 1 — PDF rendering**: load a file and render every page to canvas with pdf.js, at device pixel density
- [x] **Milestone 2 — Signature pad**: draw a transparent-PNG signature in a modal (uploading an existing PNG is still open)
- [x] **Milestone 3 — Placement**: drag, resize and delete signature overlays with react-rnd, on any page and any number of times
- [x] **Milestone 4 — Export**: compose and download the signed PDF with pdf-lib (unrotated pages only — see [Architecture Notes](docs/ARCHITECTURE.md))
- [ ] **Milestone 5 — Polish**: error states, keyboard shortcuts, responsive UI adaptation for mobile devices and different screen sizes, deployment

See the [Development Guide](docs/GUIDE.md) for what each milestone involves.

## Project Structure

```
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

- Multiple signatures / initials / date stamps
- Saved signature library (localStorage)
- Multi-party signing and cloud archive (would require a small Node/Express backend + object storage such as S3/R2 — deliberately out of scope for the MVP)

## License

MIT — see [LICENSE](LICENSE).
