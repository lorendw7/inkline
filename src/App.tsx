import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from './lib/pdf'
import { PdfPage } from './components/PdfPage'
import { SignaturePadModal } from './components/SignaturePadModal'
import type { Placement } from './lib/types'
import { loadImageSize } from './lib/image'
import { Rnd } from 'react-rnd'



/**
 * Every page is rendered at this width in CSS pixels, so a single constant
 * fixes the scale for the whole document. Milestone 4 converts overlay
 * coordinates back into PDF points using the same number.
 */
const DISPLAY_WIDTH = 800;

/**
 * Initial on-screen width of a placed signature, in CSS pixels. Only the width
 * is a constant: the height follows from the image's own aspect ratio, so a
 * wide scrawl and a tall one both keep their proportions.
 */
const SIGNATURE_WIDTH = 180;

/**
 * Owns all app state as plain, serializable data; everything below is a view
 * over it. See docs/ARCHITECTURE.md.
 */
function App() {
  // null until the user picks a file
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);

  // Whether the signature modal is mounted. The modal has no such state of its
  // own — see SignaturePadModal.
  const [isPadOpen, setIsPadOpen] = useState(false);

  const [signature, setSignature] = useState<string | null>(null);

  // Every signature placed on a page, as plain data. The overlay is only a view
  // over this array, so dragging edits numbers here rather than the DOM, and the
  // export code in Milestone 4 reads the same numbers.
  const [placements, setPlacements] = useState<Placement[]>([]);

  // The placement the user currently has hold of, or null. Only drives the
  // highlight for now, but it is also the "selected" notion the delete button
  // and the Delete key will need.
  const [activeId, setActiveId] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return; // the dialog was opened and cancelled

    const bytes = await file.arrayBuffer();
    const doc = await loadPdf(bytes);

    // Storing the document re-renders App, which mounts one PdfPage per page.
    setPdfDoc(doc);
    setFileName(file.name);
  }

  // Async because the placement's height depends on the image's aspect ratio,
  // and the browser only reports that once the image has decoded.
  async function handleConfirmSignature(dataUrl: string) {
    setSignature(dataUrl);
    setIsPadOpen(false);

    const natural = await loadImageSize(dataUrl);
    const width = SIGNATURE_WIDTH;
    const height = width * (natural.height / natural.width);

    // One signature at a time for now, so the array is replaced rather than
    // appended to. It lands near the top of the first page, horizontally
    // centred — a visible starting point the user then drags where they want.
    setPlacements([{
      id: crypto.randomUUID(),
      pageIndex: 0,
      x: (DISPLAY_WIDTH - width) / 2,
      y: 100,
      width,
      height
    }]);
  }

  /**
   * Overwrite some fields of one placement, leaving the rest alone.
   *
   * `Partial<Placement>` is what lets one function serve both callers: a drag
   * patches x/y, a resize patches all four. Nothing is mutated — `map` builds a
   * new array and the spread builds a new object, but only for the placement
   * that actually changed, so React can skip the others.
   */
  function updatePlacement(id: string, patch: Partial<Placement>) {
    setPlacements(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p))
    );
  }

  /**
   * Drop one placement. Filter rather than map: this removes an item instead
   * of rewriting one, and again it returns a new array so React sees a change.
   *
   * Clearing activeId matters because it may still name the placement that just
   * went away. Nothing breaks if it does — no id would match — but leaving a
   * reference to something deleted is the kind of thing that bites once the
   * Delete key starts reading the same state.
   */
  function removePlacement(id: string) {
    setPlacements(prev => prev.filter(p => p.id !== id));
    setActiveId(null);
  }


  return (
    <div className="min-h-screen bg-neutral-100">
      <header className='sticky top-0 z-10
      flex items-center gap-4 border-b border-neutral-200 bg-white px-6 py-3'>
        <h1 className="text-lg font-semibold">
          Inkline
        </h1>

        {/* A label forwards clicks to the input it wraps, so the unstylable
            native file input can stay visually hidden while this styled label
            acts as the button. `sr-only` rather than `hidden` keeps the input
            reachable by keyboard, and `focus-within` shows its focus ring here. */}
        <label className="inline-flex cursor-pointer items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus-within:ring-2 focus-within:ring-neutral-400">
          Open PDF
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="sr-only"
          />

        </label>

        {/* A sibling of the label, not a child: a label may only wrap the one
            form control it names, and a nested button would be a second one. */}
        <button
          type='button'
          onClick={() => setIsPadOpen(true)}
          className='rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100'>
          Sign
        </button>
        {fileName && <span className="text-sm text-neutral-500">{fileName}</span>}
        {/* A data URL carries the image bytes inline, so it goes straight into
            `src` with no network request and no object URL to revoke. */}
        {
          signature &&
          (
            <img src={signature}
              alt="Your signature"
              className='ml-auto h-8 rounded border border-neutral-200 bg-white' />
          )
        }
      </header>
      <div className='flex flex-col items-center gap-6 p-8'>
        {/* Nothing renders before a document is loaded: `null && ...` is null,
            and React renders null as nothing. */}
        {
          pdfDoc &&
          Array.from({ length: pdfDoc.numPages }, (_, index) => (
            <PdfPage key={index} pageNumber={index + 1} pdfDoc={pdfDoc} displayWidth={DISPLAY_WIDTH}>
              {/* Each page draws only the placements that belong to it. The
                  filter is what turns one flat array into per-page overlays. */}
              {
                placements.filter(p => p.pageIndex === index)
                  .map(p => (
                    // Controlled, not uncontrolled: Rnd is told where to be on
                    // every render instead of remembering it internally. That
                    // costs a round trip through state on each gesture, and buys
                    // the guarantee that `placements` is never out of date —
                    // which is the whole point, because Milestone 4 exports
                    // these numbers and cannot reach inside Rnd to get them.
                    <Rnd
                      key={p.id}
                      position={{ x: p.x, y: p.y }}
                      size={{ width: p.width, height: p.height }}
                      // Resolves to PdfPage's wrapper — the same element whose
                      // `relative` makes x/y page-relative in the first place.
                      bounds="parent"
                      // The ratio came from the image's natural size, so locking
                      // it is what keeps the signature from being squashed.
                      lockAspectRatio
                      // A mousedown anywhere inside this box normally starts a
                      // drag, and the delete button is inside it. This selector
                      // exempts the button, which would otherwise be almost
                      // impossible to click without dragging the signature away.
                      cancel='.no-drag'
                      // Two pixels of border are always there and only the
                      // colour changes, so the image never shifts when the
                      // highlight appears. A border sits inside the box, which
                      // an outline or a ring would not — those get clipped by
                      // the page wrapper's overflow-hidden at the very edge.
                      className={`group border-2 ${activeId === p.id ? 'border-blue-500' : 'border-transparent'}`}
                      // The start handlers light the highlight and the stop
                      // handlers put it out, so the two gestures share one
                      // piece of state rather than each growing their own.
                      onDragStart={() => setActiveId(p.id)}
                      // `data` already carries the new top-left corner.
                      onDragStop={(_e, data) => {
                        setActiveId(null);
                        updatePlacement(p.id, { x: data.x, y: data.y });
                      }}
                      onResizeStart={() => setActiveId(p.id)}
                      // Position is patched alongside size because a top or left
                      // handle pins the opposite corner and moves the origin.
                      // Size is read off the element rather than from `_delta`,
                      // which is only the change; parseFloat turns Rnd's
                      // "213.5px" into a number without rounding it.
                      onResizeStop={(_e, _dir, ref, _delta, position) => {
                        setActiveId(null);
                        updatePlacement(p.id, {
                          width: parseFloat(ref.style.width),
                          height: parseFloat(ref.style.height),
                          x: position.x,
                          y: position.y
                        });
                      }}
                    >
                      {/* Fills the box Rnd sizes, so resizing the box resizes the
                        image. A placement only exists after a signature was
                        confirmed, so `src` never really falls back. */}
                      <img
                        src={signature ?? undefined}
                        alt=''
                        // `select-none` keeps a drag from turning into a text
                        // selection, which would compete for the same gesture.
                        className='h-full w-full select-none'
                        // An <img> is a native drag source by default, and a
                        // native drag replaces mousemove/mouseup with its own
                        // event set. react-draggable would then never see the
                        // mouseup it is waiting for, stay stuck in "dragging",
                        // and keep moving the signature after the button is
                        // released. Opting out of native dragging is the fix.
                        draggable={false}
                      />
                      {/* Corner-inset rather than hanging outside the box, so
                          the page wrapper's overflow-hidden cannot clip it when
                          the signature sits flush against the page edge. It does
                          cover the top-right resize handle — with the aspect
                          ratio locked, the other three corners do the same job.
                          `no-drag` is the class the cancel selector looks for,
                          and `group-hover` pairs with `group` on the Rnd box, so
                          hovering anywhere over the signature fades this in.
                          `focus-visible` does the same for keyboard users, who
                          would otherwise land on a button they cannot see —
                          and it is focus-visible rather than focus so a mouse
                          click does not leave the button stuck on. */}
                      <button
                        type='button'
                        className='no-drag absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs leading-none text-white opacity-0 transition-opacity 
                        group-hover:opacity-100 focus-visible:opacity-100'
                        // The label is a bare glyph, so the accessible name has
                        // to be spelled out for screen readers.
                        aria-label='Remove signature'
                        onClick={() => removePlacement(p.id)}
                      >
                        ×
                      </button>
                    </Rnd>
                  ))
              }
            </PdfPage>
          ))
        }
      </div>
      {
        isPadOpen && <SignaturePadModal onClose={() => setIsPadOpen(false)} onConfirm={handleConfirmSignature} />
      }
    </div>
  )
}

export default App;
