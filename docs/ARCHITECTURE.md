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
     │              placements[] { pageIndex, x, y, w, h }  (page widths)
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

| | Placement | PDF (pdf-lib) |
|---|---|---|
| Unit | one page width | point (1/72 inch) |
| Origin | top-left of the page | bottom-left of page |
| Y direction | down | up |
| `drawImage` y refers to | image top (CSS `top`) | image **bottom** edge |

A placement is not stored in pixels. All four of its numbers are lengths measured against the page's own width, so `x: 0.25` is a quarter of a page-width in from the left and `width: 1` is exactly one page across. For a page that is `W` × `H` points:

```
pdfX = x × W
pdfW = w × W
pdfH = h × W                  // W, not H — both axes are measured against the width
pdfY = H − y×W − pdfH         // flip the axis, then step down by the image height
```

`W` appears three times and `H` once. Measuring both axes against the width is what keeps a square signature stored as `w === h`, and what lets the conversion back need only one of the page's two dimensions — the consequence being that `y` and `h` routinely exceed 1, since an A4 page is 1.414 page-widths tall. They are lengths, not percentages.

Keep this in one pure function in `src/lib/coords.ts` and unit-test it mentally with the corners:

- top-left placement `(0, 0)` → `pdfY = H − pdfH` ✓ (flush with the top in PDF space)
- a placement resting on the bottom edge → `pdfY = 0` ✓
- `width = 1` → `pdfW = W` ✓ (the unit's definition falling out of the arithmetic)

**Why not pixels.** It used to be pixels, relative to a canvas fixed at 800 wide, and the export had to be handed that 800 to undo it. That worked only for as long as 800 never moved — which ended the moment a page had to fit a phone. Screen-independent units cost one multiplication at the react-rnd boundary and buy a placement that survives a resize, a rotated phone, and any future zoom, plus an export module that no longer has to be told anything about a browser.

### Gotchas

- **Per-page scale.** Rendering still has a scale, and it is per page: a document may mix page sizes, so `getDisplayScale()` is asked of each page separately in `PdfPage`. It no longer touches coordinates — a placement is in page widths and needs no scale to be understood — so the number now lives and dies inside one render call. That is the gotcha in its current form: if a `scale` ever escapes back into placement maths, something has regressed.
- **CSS px vs device px.** The display width the app works in is CSS pixels — what `ResizeObserver` reports and what react-rnd positions in. Rendering at `devicePixelRatio` for sharpness only changes `canvas.width` against its CSS width, and that multiplication stays inside `renderPage()`. Nothing outside it should ever see a device pixel.
- **A page's width is not a constant.** It is `min(container width, 800)` and changes when the window changes, so anything derived from it must be derived on each render rather than captured once. This is the reason placements are stored in page widths in the first place: the one number that moves is confined to the react-rnd boundary, and the stored data is immune to it.
- **Detached ArrayBuffer.** pdf.js may transfer the buffer to its worker. Hand pdf.js a copy (`bytes.slice(0)`) and keep the original for pdf-lib.
- **Rotated pages.** `/Rotate 90/180/270` changes what "up" means. pdf.js viewports bake rotation in; pdf-lib's `drawImage` does not, so a signature placed on a turned page exports to the wrong corner. Supporting it — remapping x/y per rotation case, passing `rotate:` to `drawImage`, and reconciling a placement's "displayed width" with `getSize().width` once the two stop agreeing — was considered and **dropped**, not deferred; the reasoning is in [GUIDE.md](GUIDE.md) → Milestone 6d. The consequence is load-bearing rather than merely absent: it is what lets `placementToPdfRect` stay a four-line function of one width and one height, and what lets a placement's unit mean the page's width with no second reading held in reserve.
- **Encrypted PDFs — and the two definitions of the word.** The open path does *not* protect the export path, and the reason is that the two libraries are answering different questions. pdf.js refuses only a document whose content needs a password to be read; `PDFDocument.load` refuses any document carrying encryption at all. A file with an owner password and no user password — "read it, but do not edit it", which describes most restricted documents — therefore opens, renders, accepts a signature, and fails only at export with `EncryptedPDFError`. Hence a `describe*` on both sides rather than one guard at the door. (`{ ignoreEncryption: true }` would push straight through, but overriding a restriction its author declared is a product decision, not a bug fix.)

## Why no backend

Everything — parse, render, compose, save — runs on typed arrays in the browser. A backend only becomes necessary for multi-party workflows (shared state) or archives (storage). If added later, the front end stays unchanged; the export step would just also `POST` the bytes.

The absence is enforced rather than merely intended. `vite.config.ts` injects a Content Security Policy into the built HTML, and its load-bearing directive is `connect-src 'none'`: the browser refuses every outbound request the page could make, whoever wrote the code making it. That is worth more than the audit it replaces. "No dependency exfiltrates anything" is a statement with a shelf life — it describes the versions in `package-lock.json` today — while a policy holds against the release of `pdfjs-dist` that has not been published yet.

It also prices the backend in the paragraph above. Adding one stops being "the export step would just also `POST` the bytes" and becomes that plus widening `connect-src` to name the host — in a diff where the widening is the line a reviewer stops at. The privacy property is now explicit enough that giving it up has to be done on purpose.
