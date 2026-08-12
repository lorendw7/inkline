# Architecture Notes

## Data flow

```
 file input          signature pad / PNG upload
     │                        │
     ▼                        ▼
 originalBytes (ArrayBuffer)  signatureDataUrl (PNG, transparent)
     │                        │
     ├─ copy ──► pdf.js ──► page canvases (display only)
     │                        │
     │              placements[] { pageIndex, x, y, w, h }  (CSS px)
     │                        │
     └────────────► pdf-lib ◄─┘
                      │   embedPng + drawImage (PDF points)
                      ▼
                signed.pdf (Blob download)
```

Two libraries, two jobs, deliberately separated:

- **pdf.js** only *displays*. Its canvases are throwaway pixels; nothing is ever read back from them.
- **pdf-lib** only *composes*. It re-opens the **original bytes** and draws the signature as a real PDF image XObject. Because we never rasterize the document itself, text stays selectable and the output stays small and crisp — this is also why the tool avoids renderer-specific bugs like iOS Markup's color glitches: the exported file contains a plain, standards-conforming image draw.

State lives in `App.tsx` and is plain serializable data (`ArrayBuffer`, data URL string, `Placement[]`). Components are views over it.

Failures cross the same boundary as values. Each `lib` module owns every mention of its library, exception classes included, and hands the app a finished sentence rather than an error object to interrogate: `describeLoadError` in `lib/pdf.ts` for opening, `describeExportError` in `lib/export.ts` for saving. So `App.tsx` imports nothing from `pdfjs-dist` but a type and nothing from `pdf-lib` at all, and the UI never has to know which library was disappointed. The raw error still goes to the console; only the sentence goes on screen.

That split earned itself the day the second source of failures arrived: the banner reads one `error` string and has never known where it came from, so gaining an entire second failure path added one `catch` and changed no rendering code at all.

## The two coordinate systems

This is the only genuinely tricky code in the project.

| | Screen (overlay) | PDF (pdf-lib) |
|---|---|---|
| Unit | CSS pixel | point (1/72 inch) |
| Origin | top-left of page canvas | bottom-left of page |
| Y direction | down | up |
| `drawImage` y refers to | image top (CSS `top`) | image **bottom** edge |

A page rendered at `scale` maps `1 pt → scale px`. So for a placement `(x, y, w, h)` in CSS pixels on a page that is `H` points tall:

```
pdfX = x / scale
pdfW = w / scale
pdfH = h / scale
pdfY = H − y/scale − pdfH     // flip the axis, then step down by the image height
```

Keep this in one pure function in `src/lib/coords.ts` and unit-test it mentally with the four corners:

- top-left placement `(0, 0)` → `pdfY = H − pdfH` ✓ (near the top in PDF space)
- bottom-left placement `(0, canvasHeight − h)` → `pdfY = 0` ✓

### Gotchas

- **Per-page scale.** If pages have different sizes, each has its own `scale`. Store it alongside the rendered canvas, never as a single global.
- **CSS px vs device px.** Do the math in CSS pixels (what react-rnd reports). If you render pdf.js canvases at `devicePixelRatio` for sharpness, that only changes `canvas.width` vs its CSS width — your `scale` must be based on the **CSS** width.
- **Detached ArrayBuffer.** pdf.js may transfer the buffer to its worker. Hand pdf.js a copy (`bytes.slice(0)`) and keep the original for pdf-lib.
- **Rotated pages.** `/Rotate 90/180/270` changes what "up" means. pdf.js viewports bake rotation in; pdf-lib's `drawImage` does not. MVP: detect `page.getRotation()` and warn; full support means remapping x/y per rotation case and passing `rotate:` to `drawImage`.
- **Encrypted PDFs — and the two definitions of the word.** The open path does *not* protect the export path, and the reason is that the two libraries are answering different questions. pdf.js refuses only a document whose content needs a password to be read; `PDFDocument.load` refuses any document carrying encryption at all. A file with an owner password and no user password — "read it, but do not edit it", which describes most restricted documents — therefore opens, renders, accepts a signature, and fails only at export with `EncryptedPDFError`. Hence a `describe*` on both sides rather than one guard at the door. (`{ ignoreEncryption: true }` would push straight through, but overriding a restriction its author declared is a product decision, not a bug fix.)

## Why no backend

Everything — parse, render, compose, save — runs on typed arrays in the browser. A backend only becomes necessary for multi-party workflows (shared state) or archives (storage). If added later, the front end stays unchanged; the export step would just also `POST` the bytes.
