# Development Guide

This guide breaks the project into small milestones. Each milestone has a goal, the key APIs you'll need, hints, and a checkpoint to verify before moving on. You write all the code — this document only points the way.

---

## Milestone 0 — Scaffold

**Goal:** A running React + Vite + Tailwind app.

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install pdfjs-dist pdf-lib signature_pad react-rnd
npm install -D tailwindcss @tailwindcss/vite
```

- Wire Tailwind v4 via the Vite plugin (`@tailwindcss/vite`) and a single `@import "tailwindcss";` in your CSS.
- **Checkpoint:** `npm run dev` shows a styled page.

---

## Milestone 1 — Load and render a PDF (pdf.js)

**Goal:** User picks a `.pdf` file; every page renders as a canvas in a scrollable column.

**Key APIs:**
- `<input type="file" accept="application/pdf">` → `file.arrayBuffer()`
- `pdfjs-dist`: `getDocument({ data }).promise` → `PDFDocumentProxy`
- `pdf.getPage(n)` → `page.getViewport({ scale })` → `page.render({ canvas, viewport })` → `.promise`
  - `render` takes `canvas` as of `pdfjs-dist` v6; `canvasContext` still works but is
    kept only for backwards compatibility.
  - `render` returns a `RenderTask`, not a promise — keep the task so you can `cancel()` it.

**Hints:**
- pdf.js needs a worker. With Vite:
  ```ts
  import * as pdfjs from "pdfjs-dist";
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url
  ).toString();
  ```
- Keep **two copies** of the file bytes conceptually: the original `ArrayBuffer` (for pdf-lib later) and the rendered canvases (for display only). pdf.js may transfer/detach the buffer you pass it — pass it a copy (`bytes.slice(0)`).
- Render each page in its own `<canvas>` inside a React component; use a `ref` + `useEffect`. Guard against double-render in React StrictMode (cancel the render task in the effect cleanup).
- Pick a display scale so the page fits your layout (e.g. fixed CSS width, compute `scale = displayWidth / viewport.width` at scale 1). **Record the scale per page** — you'll need it for coordinate math in Milestone 4.
- For sharp text on high-DPI screens, size the canvas *bitmap* at `scale * devicePixelRatio` and set `canvas.style.width/height` back down to the CSS size. Keep that multiplication inside the render helper: the scale you record for coordinates must stay CSS-based (see [ARCHITECTURE.md](ARCHITECTURE.md) → Gotchas).

**Checkpoint:** A multi-page PDF displays crisply; scrolling works; no console errors.

---

## Milestone 2 — Signature pad (signature_pad)

**Goal:** A modal where the user draws a signature and confirms it, producing a **transparent PNG data URL**.

**Key APIs:**
- `new SignaturePad(canvas, { penColor, minWidth, maxWidth })`
- `pad.isEmpty()`, `pad.clear()`, `pad.toDataURL("image/png")`

**Hints:**
- Do **not** set a background color — transparency is what makes the signature composite cleanly onto the page.
- Handle high-DPI screens: set `canvas.width = cssWidth * devicePixelRatio`, scale the 2D context, and call `pad.clear()` after resizing (signature_pad's docs cover this).
- Trim surrounding whitespace before saving if you want tight placement (optional: scan the pixel alpha channel for the bounding box, or skip for MVP).
- Also add an "upload PNG" path — it's just a `FileReader.readAsDataURL`, and it reuses everything downstream.

**Checkpoint:** Draw → confirm → you can `<img src={dataUrl}>` it and see a transparent-background signature.

---

## Milestone 3 — Place the signature (react-rnd)

**Goal:** After confirming a signature, an overlay appears on a page; the user can drag it anywhere and resize it with a fixed aspect ratio.

**Model the placement as data**, not as DOM state:

```ts
interface Placement {
  id: string;
  pageIndex: number;
  x: number;      // CSS px, relative to that page's canvas top-left
  y: number;
  width: number;  // CSS px
  height: number;
}
```

**Hints:**
- Make each page's wrapper `position: relative`; render `<Rnd>` absolutely inside it so `x/y` are page-relative automatically.
- `<Rnd>` props you'll want: `bounds="parent"`, `lockAspectRatio`, `onDragStop`, `onResizeStop` — update your `Placement` state in the stop handlers.
- Default initial size: signature's natural aspect ratio at ~180 px wide, centered-ish.
- Allow deleting a placement (small × button on hover).

**Checkpoint:** The signature image can be dragged/resized on any page and its state survives re-renders.

---

## Milestone 4 — Export (pdf-lib) — the coordinate math

**Goal:** "Export" produces a new PDF with the signature drawn into the page content, downloaded as a file.

**Key APIs:**
- `PDFDocument.load(originalBytes)`
- `pdfDoc.embedPng(pngBytes)` → `PDFImage`
- `page.drawImage(img, { x, y, width, height })`
- `pdfDoc.save()` → `Uint8Array` → `new Blob([bytes], { type: "application/pdf" })` → object URL → `<a download>`

**The one hard part — coordinates.** Read [ARCHITECTURE.md](ARCHITECTURE.md) first. In short:

- Your overlay coordinates are **CSS pixels, origin top-left, y grows down**.
- PDF coordinates are **points, origin bottom-left, y grows up**.
- Conversion (no rotation case):
  ```
  scale   = renderedCssWidth / pageWidthInPoints
  pdfX    = x / scale
  pdfW    = width / scale
  pdfH    = height / scale
  pdfY    = pageHeightInPoints - (y / scale) - pdfH
  ```
  Note `drawImage`'s `y` is the image's **bottom** edge.

**Hints:**
- Get `pageWidthInPoints/HeightInPoints` from pdf-lib's `page.getSize()` (or pdf.js viewport at scale 1 — they agree for unrotated pages).
- Convert the signature data URL to bytes with `fetch(dataUrl).then(r => r.arrayBuffer())`.
- Test with a placement in each corner of the page to prove the math.
- Rotated pages (`page.getRotation()` ≠ 0) need extra transform work — fine to punt for MVP, but detect and warn.

**Checkpoint:** Exported PDF opens in a real viewer (Acrobat/Chrome/macOS Preview) with the signature exactly where you placed it — including near all four corners.

---

## Milestone 5 — Polish

- Site identity: an SVG favicon in `public/`, a real `<title>`, a description,
  `theme-color`, and Open Graph tags for link previews. Two traps: only
  `index.html` and CSS get Vite's `base` rewriting, and `og:image`/`og:url` must
  be absolute URLs because crawlers have no page to resolve them against.
- Loading states (PDF parsing, export)
- Empty states and error handling (non-PDF file, encrypted PDF — `PDFDocument.load` throws; catch and show a message)
- Selection: a placed signature stays selected after the mouse comes up, and a
  press on the page lets it go. The container hears that press on its way up
  from whatever was hit, so it has to ask `closest()` whether the press landed
  inside a signature — clearing unconditionally would cancel each selection in
  the same click that made it.
- Keyboard (`Delete`, `Esc`): dropped, not deferred. Both commands are already
  one click away on an object the pointer is on top of, and a global `keydown`
  listener brings its own problems — a handler created in one render keeps
  reading that render's state unless the dependency array says otherwise, and
  two listeners on `window` both fire, so the modal and the page would answer
  the same `Esc`. Not worth it for this app; worth knowing why.
- Mobile: signature_pad works with touch out of the box; check react-rnd touch behavior
- Responsive UI adaptation for mobile devices and different screen sizes
- Deploy: `npm run build` → Vercel or GitHub Pages (set Vite `base` if using Pages under a subpath)
  
---

## Suggested order of files

1. `src/lib/pdf.ts` — load + render helpers (Milestone 1)
2. `src/components/PdfViewer.tsx` (Milestone 1)
3. `src/components/SignaturePad.tsx` (Milestone 2)
4. `src/components/SignatureOverlay.tsx` + placement state in `App.tsx` (Milestone 3)
5. `src/lib/coords.ts` + `src/lib/export.ts` (Milestone 4)
