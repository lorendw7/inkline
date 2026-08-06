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
- [ ] **Milestone 2 — Signature pad**: draw/upload a transparent-PNG signature
- [ ] **Milestone 3 — Placement**: drag & resize the signature overlay with react-rnd
- [ ] **Milestone 4 — Export**: compose and download the signed PDF with pdf-lib
- [ ] **Milestone 5 — Polish**: error states, keyboard shortcuts, responsive UI adaptation for mobile devices and different screen sizes, deployment

See the [Development Guide](docs/GUIDE.md) for what each milestone involves.

## Project Structure (planned)

```
src/
  App.tsx                 # Top-level state: pdf bytes, signature image, placements
  components/
    PdfViewer.tsx         # Renders pages with pdf.js; hosts placement overlays
    SignaturePad.tsx      # Modal with signature_pad drawing surface
    SignatureOverlay.tsx  # react-rnd wrapper for one placed signature
    Toolbar.tsx           # Upload / sign / export actions
  lib/
    pdf.ts                # pdf.js load & render helpers
    export.ts             # pdf-lib composition: embed image, save bytes
    coords.ts             # Canvas-pixel <-> PDF-point coordinate conversion
```

## Documentation

- [Development Guide](docs/GUIDE.md) — step-by-step milestones for building the tool
- [Architecture Notes](docs/ARCHITECTURE.md) — coordinate systems, data flow, and the tricky parts

## Roadmap (post-MVP)

- Multiple signatures / initials / date stamps
- Saved signature library (localStorage)
- Multi-party signing and cloud archive (would require a small Node/Express backend + object storage such as S3/R2 — deliberately out of scope for the MVP)

## License

MIT — see [LICENSE](LICENSE).
