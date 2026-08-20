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
- Pick a display width so the page fits your layout, and derive the scale from it: `scale = displayWidth / viewport.width` at scale 1. Start with a fixed width if you like — but treat it as a *view* decision only, and see Milestone 3 before you let that number into your placement data. (Inkline ended up with `min(container width, 800)`, watched by a `ResizeObserver`.)
- For sharp text on high-DPI screens, size the canvas *bitmap* at `scale * devicePixelRatio` and set `canvas.style.width/height` back down to the CSS size. Keep that multiplication inside the render helper — nothing outside it should ever see a device pixel (see [ARCHITECTURE.md](ARCHITECTURE.md) → Gotchas).

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
  x: number;      // in page widths, from that page's top-left, y growing down
  y: number;
  width: number;  // in page widths
  height: number;
}
```

**Choose the unit before you write the handlers.** CSS pixels are the obvious
choice — react-rnd reports them and no conversion is needed — but they are only
meaningful next to the width the page happened to be drawn at, and that number
moves the day the app has to fit a phone. Measuring everything against the
page's own width instead costs one multiply on the way into `<Rnd>` and one
divide on the way out, and buys placements that survive a resize, a rotation,
and any future zoom. Both axes against the *width*, not each against its own
dimension: that is what keeps a square signature stored as `width === height`.

**Hints:**
- Make each page's wrapper `position: relative`; render `<Rnd>` absolutely inside it so `x/y` are page-relative automatically.
- `<Rnd>` props you'll want: `bounds="parent"`, `lockAspectRatio`, `onDragStop`, `onResizeStop` — update your `Placement` state in the stop handlers.
- Keep the two conversions in one named pair (`toPx` / `toFraction`). A multiply and a divide look alike and applying the wrong one throws no error — only a signature in the wrong place.
- Default initial size: the signature's natural aspect ratio at a bit under a quarter of a page wide. An aspect ratio is dimensionless, so `height = width × ratio` holds whatever unit you picked.
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

- Your placement coordinates are **page widths, origin top-left, y grows down**.
- PDF coordinates are **points, origin bottom-left, y grows up**.
- Conversion (no rotation case), for a page `W` × `H` points:
  ```
  pdfX    = x × W
  pdfW    = width × W
  pdfH    = height × W          // W, not H — both axes measure against the width
  pdfY    = H - (y × W) - pdfH
  ```
  Note `drawImage`'s `y` is the image's **bottom** edge.

  `W` three times and `H` once. Nothing in this function refers to a screen —
  if you find yourself passing it a display width, the unit in Milestone 3 went
  wrong.

**Hints:**
- Get `W`/`H` from pdf-lib's `page.getSize()` (or pdf.js viewport at scale 1 — they agree for unrotated pages). Ask **per page**: one document may mix page sizes, and the same `0.5` is a different number of points on A4 and on Letter.
- Convert the signature data URL to bytes with `fetch(dataUrl).then(r => r.arrayBuffer())`.
- Test with a placement in each corner of the page to prove the math.
- Rotated pages (`page.getRotation()` ≠ 0) would need extra transform work, and this project does not do it — see Milestone 6d for the decision and its reasoning. The maths above assumes `/Rotate 0`, which is the only case it is ever handed.

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
- Responsive layout, in two parts that fail differently. The **header** is a flex
  row, and a flex container would rather squash its children than wrap, so four
  buttons fight over 390px until you add `flex-wrap` — after which its height is
  no longer a constant, and anything that measured it once has to become a
  `ResizeObserver`. The **page** is the harder half: a fixed-width canvas simply
  overflows, and centered overflow is unreachable on the left, because a
  scrollable area never extends past its own origin. Draw the page at
  `min(container width, max)` instead — which only works if a placement is not
  stored in pixels of that width (Milestone 3).
- Deploy: `npm run build` → Vercel or GitHub Pages (set Vite `base` if using Pages under a subpath)
  
---

## Milestone 6 — A signature library, a date stamp, and a pad worth drawing on

**Goal:** more than one signature exists at a time and any of them can be
placed; a date can be stamped beside a signature; and the drawing surface is big
enough to sign on with a mouse.

Three features, and the order matters — the first does most of the work for the
second. Read 6b before you finish 6a, because knowing where the date is going to
live is what stops you building the wrong shape in 6a.

### 6a — One signature becomes many

Today `App.tsx` holds one data URL:

```ts
const [signature, setSignature] = useState<string | null>(null);
```

Every placement on every page draws that same string, and confirming the pad a
second time silently rewrites every signature already on the document. That is
not a bug anyone reported, because with one signature there is nothing to tell
apart — but it is the reason "sign here as me, and here as the witness" cannot
be expressed at all.

**The state change.** A new shape in `lib/types.ts`:

```ts
interface Signature {
  id: string;
  dataUrl: string;   // transparent PNG, exactly as today
  label: string;     // "Signature", "Initials", "Date" — what the picker shows
}
```

`Placement` gains one field, and it is the whole feature:

```ts
signatureId: string;   // which Signature this copy draws
```

`App` then holds `signatures: Signature[]` and `activeSignatureId: string | null`
in place of the single string.

**The invariant you now maintain by hand.** A placement naming a signature that
no longer exists is a broken document: the overlay has no `src` and the export
has no image. Nothing in TypeScript enforces this — `signatureId` is a `string`
and any string type-checks. So decide the deletion rule once and write it down
beside the state:

- deleting a signature deletes its placements too (simple, and destructive in a
  way the user may not expect), **or**
- a signature that is in use cannot be deleted, and the button says why.

Either is defensible. Choosing neither is what produces the bug six weeks later.

**Hints:**

- The overlay needs the image, not the id. Build the lookup once per render —
  `new Map(signatures.map(s => [s.id, s]))` — rather than calling
  `signatures.find()` inside the placement loop; the loop runs once per placed
  copy and the map is the same three lines either way.
- `addPlacement(dataUrl, pageIndex)` becomes `addPlacement(signatureId, pageIndex)`.
  It still needs the natural aspect ratio, so it still reaches `loadImageSize` —
  now through the lookup. The `await` in the middle is still there, so the
  `setPlacements(prev => …)` updater form is still load-bearing (the comment
  already in that function explains why).
- The fan-out offset counts copies on the page. Consider counting copies *of
  this signature* on the page instead, so a date and a signature added in turn
  do not push each other down.
- The header's "Place again" button acts on `activeSignatureId`. The picker — a
  row of thumbnails under the header, or inside the modal — is what sets it.
  Selecting is not placing: keep the two clicks separate, or you cannot look at
  the library without dropping something on the page.
- `key` on the thumbnail list is `s.id`, never the array index. An index key
  makes React reuse the wrong `<img>` the moment one is deleted from the middle.

**The export changes shape.** `exportSignedPdf(bytes, signature, placements)`
takes an array now. Inside, the comment about embedding once outside the loop
still applies — it just becomes once *per distinct signature*:

```ts
const images = new Map<string, PDFImage>();
for (const s of used) images.set(s.id, await doc.embedPng(s.dataUrl));
```

Two traps in those two lines:

- `used`, not `signatures`. Embedding the whole library writes every signature
  the user ever drew into the exported file, including the ones they rejected
  and never placed. That is wasted bytes on a good day and a privacy leak on a
  bad one — a discarded signature travelling inside a document that was sent to
  someone else. Filter to the ids that actually appear in `placements` first.
- A `for … of` loop, not `signatures.map(async …)`. An async callback hands
  `map` a promise, so what comes back is `Promise<PDFImage>[]` and every value
  in it is pending, not an image. If you want the parallel version it is
  `await Promise.all(used.map(s => doc.embedPng(s.dataUrl)))` — correct, and
  worth writing out once to see why the shorter thing was wrong.

**Checkpoint:** two visibly different signatures on one page, each dragged
somewhere, both landing correctly in the exported PDF; deleting one from the
library behaves the way you wrote down; and the exported file does not contain a
signature you never placed.

### 6b — The date is not a new feature

The pipeline takes a **transparent PNG data URL** and knows nothing else about
where it came from — drawing produced one in Milestone 2, an upload would
produce one from `FileReader`, and text drawn on a canvas produces one too. So
the date is not a second kind of object to place. It is a third way to make a
`Signature`, and once 6a exists it inherits placing, dragging, resizing,
deleting and exporting for free.

Build it as `src/lib/stamp.ts`, one pure function:

```ts
function renderTextToPng(text: string, opts?: { fontPx?: number; color?: string }): string
```

**Key APIs:** `document.createElement("canvas")`, `ctx.font`, `ctx.measureText`,
`ctx.fillText`, `canvas.toDataURL("image/png")`, and `Intl.DateTimeFormat` for
the text itself.

**Hints and traps:**

- Measure before you size. You need the ink box to size the canvas, and a canvas
  to measure with — so measure on a throwaway context first, then size the real
  one.
- `measureText(t).width` is the *advance* width: it includes side bearings and
  misses an italic overhang. `actualBoundingBoxLeft/Right/Ascent/Descent` give
  the ink, which is what tight placement wants — an image padded unevenly makes
  a centred date look off-centre while nothing in the placement maths is wrong.
- Assigning `canvas.width` resets the entire 2D context — transform, `font`,
  `fillStyle`, all of it. Set them **after** sizing, never before. This is the
  same trap as the DPR handling in `SignaturePadModal`, meeting you in a second
  place.
- Render at `devicePixelRatio`, for the same reason pages do, and let the
  placement scale it back down. A date sits small on the page, and rasterized
  text is the first thing to look cheap.
- **Do not** `fillRect` a background. Transparency is what makes it composite
  onto the page, exactly as with a drawn signature.
- The font has to be one the machine already has. `connect-src 'none'` and
  `font-src data:` mean there is no webfont to fetch — deliberately. Use a stack
  (`"ui-sans-serif, system-ui, sans-serif"`) and accept that glyphs differ
  slightly per machine, or ship one with the app. `ctx.font` fails *silently* on
  an unavailable family: it falls back, the measurement changes, and nothing
  anywhere reports it.
- Default the text to today — `new Intl.DateTimeFormat(locale, { … }).format(new Date())`
  rather than a bare `toLocaleDateString()`, whose output moves between
  browsers. Then let the user edit it: the date on a document is very often not
  today's, and a text input costs one `<input>`.

**Why not `page.drawText`.** pdf-lib can draw real text, and it is tempting:
selectable, crisp at any zoom, a few bytes, and `StandardFonts.Helvetica` is
built into the library rather than fetched — which matters here, since a request
is the one thing this app forbids. The cost is where it always is with a second
code path. `Placement` forks into two kinds, each needing its own overlay, its
own export branch and its own conversion; and the on-screen preview has to
reproduce pdf-lib's font metrics through `font.widthOfTextAtSize()`, because the
browser's Helvetica and the PDF standard's Helvetica are not the same widths.
Get that wrong and the date lands at a different size from the box the user
dragged. The raster route reuses one proven path and is exact by construction.
Take it — and keep `drawText` in mind for the day someone needs the date to be
machine-readable.

**Checkpoint:** an "Add date" button puts today's date in the library beside the
signatures, and it places, drags, resizes and exports through exactly the code
6a already made general. `git diff --stat` on `lib/export.ts` for this half is
zero lines.

### 6c — A pad worth drawing on

`SignaturePadModal` draws into a `w-full max-w-lg` panel (512 px) with an `h-48`
canvas (192 px). That is a reasonable phone size and a cramped desktop one: a
mouse needs room a fingertip does not, and a signature drawn in a small box is
scaled up on the page, magnifying every wobble.

Widen the panel and deepen the canvas from the `sm:` breakpoint up —
`sm:max-w-3xl` with `sm:h-72` is a sensible starting pair — leaving the phone
layout exactly as it is.

**The trap this exposes, which is the real work here.** The bitmap is sized once,
in an effect that depends only on `dpr`:

```ts
canvas.width = canvas.offsetWidth * dpr;
```

`offsetWidth` is a CSS-pixel measurement taken at that instant. Resize the window
and the element's CSS width changes while its bitmap does not, so the browser
stretches the bitmap to fit — and signature_pad, which maps pointer coordinates
through that same ratio, starts drawing at an offset from the cursor that grows
with the mismatch. It is already latent today (`w-full` below 512 px); a wider
panel only means more people meet it.

The fix is the pattern this app already uses twice: a `ResizeObserver` on the
canvas, re-running the sizing. Two consequences to handle deliberately:

- Assigning `canvas.width` **clears the drawing** and resets the context, so the
  `scale(dpr, dpr)` has to be reapplied and `isEmpty` re-synced.
- Whether to preserve the strokes is a genuine decision, not an oversight.
  `pad.toData()` / `pad.fromData()` replay points recorded against the *old* CSS
  width, so they land on the same numbers on a canvas of a different size — the
  signature keeps its pixel size while the box around it changes. The simplest
  honest behaviour is to resize only while the pad is empty and otherwise leave
  the bitmap alone until the user clears. Whatever you pick, the outcome to
  avoid is silently losing a drawing to a window nudge.
- `MAX_DPR = 3` earns its keep at the new size. Bitmap area grows with the square
  of both factors, so a 768-wide pad at an uncapped DPR of 4 is tens of megabytes
  allocated for a signature.

**Checkpoint:** on a desktop the pad is noticeably roomier; the ink still lands
under the cursor after the window is resized; on a phone nothing changed.

### 6d — Rotated pages: dropped, not deferred

`/Rotate 90/180/270` support is **cancelled**, the same way keyboard shortcuts
were in Milestone 5 — a decision, not a gap left open.

The reasoning: it is the most intricate change left in the project (remap `x`/`y`
per rotation case, pass `rotate:` to `drawImage`, and reconcile `Placement`'s
"displayed width" with `getSize().width`, which stop agreeing the moment a page
is turned) and it buys the least. A rotated page is rare in the documents this
tool exists for, and the workaround — rotate and re-save it in any PDF viewer
first — is thirty seconds long and available to everyone. The three features
above are wanted on every document.

Concretely, this is what dropping it buys: `placementToPdfRect` stays a four-line
function of one page width and one page height, and `Placement`'s unit can simply
say "the page's width" instead of keeping two readings alive for a milestone that
is no longer coming.

A dropped plan leaves promises behind. The prose in `README.md`,
`docs/ARCHITECTURE.md` and Milestone 4 above has been reworded already; two
comments in the source still promise the milestone that is not coming, and are
yours to change:

- `src/lib/coords.ts` (~line 60) — "that mismatch is precisely what Milestone 6
  has to resolve". It is now what Milestone 6 declines to resolve.
- `src/lib/types.ts` (~line 28) — "Rotation support is a later milestone, and it
  will need this unit to have meant the displayed edge all along". The careful
  distinction that paragraph draws between the *displayed* width and
  `getSize().width` is still worth keeping — it is what makes the unrotated
  assumption explicit rather than accidental — but it is now recording why the
  two always coincide here, not preparing for the day they stop.

The unrotated-only *limitation* stays documented — it is still true. Only the
promise to remove it goes.

---

## Suggested order of files

1. `src/lib/pdf.ts` — load + render helpers (Milestone 1)
2. `src/components/PdfViewer.tsx` (Milestone 1)
3. `src/components/SignaturePad.tsx` (Milestone 2)
4. `src/components/SignatureOverlay.tsx` + placement state in `App.tsx` (Milestone 3)
5. `src/lib/coords.ts` + `src/lib/export.ts` (Milestone 4)
6. `Signature` in `src/lib/types.ts` first, then `src/lib/stamp.ts` (Milestone 6) — the
   library shape before the date that lives in it, because the date is only a
   third way to fill it
