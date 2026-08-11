import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from './lib/pdf'
import { PdfPage } from './components/PdfPage'
import { SignaturePadModal } from './components/SignaturePadModal'
import type { Placement } from './lib/types'
import { loadImageSize } from './lib/image'
import { Rnd } from 'react-rnd'
import { useVisiblePage } from './hooks/useVisiblePage'
import { exportSignedPdf } from './lib/export'



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
 * The shared look of the header's secondary buttons.
 *
 * Written once because it was already copied twice and had already drifted:
 * one copy grew the disabled variants and the other did not, which left a
 * button that greys out nothing and still lights up on hover while dead.
 *
 * Splitting the string across `+` is safe, but only because every class name
 * survives intact as literal text: Tailwind never runs this code, it scans the
 * source for things that look like class names. Anything assembled at runtime —
 * `bg-${tone}-100` — is invisible to that scan and produces no CSS at all.
 * Which is also why each fragment has to end in a space; without it two class
 * names would be glued into one that matches nothing.
 */
const BUTTON_CLASS =
  'rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium ' +
  'hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'disabled:hover:bg-transparent';


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

  // ---------------------------------------------------------------------
  // "Which page am I looking at?" — three pieces that only make sense
  // together: pagesRef says where to look, headerHeight says how much of the
  // screen to ignore, and useVisiblePage turns the two into a page number.
  // ---------------------------------------------------------------------

  // A ref is a box React keeps across renders. Passed to an element as `ref`,
  // React drops the real DOM node into `.current` after that element is on
  // screen — which is how non-React code like IntersectionObserver gets a
  // handle on it. Changing `.current` never re-renders anything; that is the
  // whole difference from state.
  //
  // This one holds the scrolling list of pages. One ref for the container is
  // all useVisiblePage needs — it finds the individual pages by attribute.
  const pagesRef = useRef<HTMLDivElement>(null);

  // How much of the viewport's top edge the sticky header hides. The observer
  // has to discount that strip, or a page still tucked behind the header would
  // count as visible and the page number would advance too early.
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // The untouched bytes of the open file, kept for pdf-lib at export time.
  // pdf.js only ever got a copy (loadPdf slices before handing over), and that
  // copy now lives transferred inside its worker — unreachable from here. This
  // is the other half of that bargain: the original stays on this side.
  //
  // A ref rather than state because nothing on screen depends on it: it is
  // written once per file and read once per export, and neither event should
  // re-render anything. It is also why the value can live outside the
  // pdfDoc-cleanup effect — raw bytes hold no worker or handle to release,
  // the garbage collector alone is enough.
  const originalBytesRef = useRef<ArrayBuffer | null>(null);

  // A rendered element's height only exists once the browser has laid it out,
  // so unlike most derived values this one genuinely cannot be computed during
  // render — reading the DOM after commit is exactly what an effect is for.
  //
  // The empty dependency array means "run once, after the first commit". That
  // is enough here because every child of the header has a fixed height, so the
  // header's own height cannot change; the day one of them wraps or grows, this
  // has to become a ResizeObserver instead.
  //
  // useEffect rather than useLayoutEffect: the number never reaches the screen,
  // it only configures the observer, so there is no flicker to race against and
  // no reason to block paint. The cost is one throwaway pass — the observer is
  // built with an offset of 0, then this state lands and it is rebuilt with the
  // real number, before the user could have scrolled anywhere.
  useEffect(() => {
    const header = headerRef.current;
    if (header) setHeaderHeight(header.getBoundingClientRect().height);
  }, []);

  // Called unconditionally, even with no document open: hooks are matched up
  // between renders by call order, so one skipped behind an `if` would throw
  // the rest out of alignment. A pageCount of 0 is a state the hook handles.
  // `??` rather than `||` — 0 is a legitimate value for a number, and the habit
  // of reaching for `||` is what turns that into a bug somewhere else.
  const visiblePage = useVisiblePage(pagesRef, pdfDoc?.numPages ?? 0, headerHeight);

  // pdfDoc is not plain data — it is the main-thread handle on a document that
  // a Web Worker keeps parsed in memory. React has exactly one place for "this
  // value owns something that must be released": an effect whose cleanup
  // releases it. Replacing the state alone would leave the old worker running
  // with a whole PDF in it.
  //
  // destroy() lives on the loading task, not on the document: the worker
  // belongs to the task that started the load, and the document proxy is only a
  // remote control for it. No `?.` after loadingTask — that getter always
  // returns a task; only pdfDoc itself can be null.
  //
  // Keyed on pdfDoc, so the cleanup closes over the *previous* document and
  // fires when a new one replaces it, and again when App unmounts. Order comes
  // for free: React runs child cleanups before parent ones, so every PdfPage
  // has already cancelled its render task by the time the worker goes away.
  //
  // destroy() returns a promise, but a cleanup function must be synchronous —
  // `void` marks the result as deliberately ignored rather than forgotten.
  useEffect(() => {
    return () => void pdfDoc?.loadingTask.destroy();
  }, [pdfDoc])

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return; // the dialog was opened and cancelled

    const bytes = await file.arrayBuffer();
    const doc = await loadPdf(bytes);

    // Stored only after loadPdf has succeeded: if parsing throws, execution
    // never reaches this line, and the ref still holds the bytes of the
    // document that is still on screen — the two can never disagree.
    originalBytesRef.current = bytes;

    // A new document invalidates everything tied to the old one: a placement
    // names a page index that may not exist here, and activeId names a
    // placement that is about to be dropped. React batches every setState in
    // this function into a single re-render — even after an await — so there is
    // no frame where the new pages are on screen under stale overlays.
    setPlacements([]);
    setActiveId(null);

    // Storing the document re-renders App, which mounts one PdfPage per page.
    setPdfDoc(doc);
    setFileName(file.name);

  }


  /**
   * Put a copy of one signature on one page.
   *
   * Takes the data URL as a parameter rather than reading the `signature`
   * state, because the confirm handler calls this in the same tick it calls
   * setSignature — and a setState never rewrites the variable this render
   * already captured. Passing the value sidesteps the question entirely.
   *
   * Async because the height comes from the image's aspect ratio, which the
   * browser only reports once the image has decoded.
   */
  async function addPlacement(dataUrl: string, pageIndex: number) {
    // Both buttons that reach this are already disabled without a document, so
    // this line is not what keeps the user out — it is what keeps the invariant
    // true no matter who calls next: no placement may name a page that has no
    // document behind it.
    if (!pdfDoc) return;
    const natural = await loadImageSize(dataUrl);
    const width = SIGNATURE_WIDTH;
    const height = width * (natural.height / natural.width);

    // Appended rather than replacing the array: the same signature can now go
    // on several pages, and more than once on one page.
    //
    // The updater form — prev => … — asks React for the array as it stands now
    // instead of using the `placements` this render captured. That matters
    // here because an await sits between the click and this line: by now the
    // user may have clicked again, and the captured copy would be one
    // placement out of date.
    setPlacements(prev => {
      // Copies already sitting on this page. Each new one starts a little
      // lower, so repeated clicks fan out downwards instead of stacking
      // invisibly on the exact same spot.
      const onThisPage = prev.filter(p => p.pageIndex === pageIndex).length;
      return [...prev, {
        id: crypto.randomUUID(),
        pageIndex: pageIndex,
        x: (DISPLAY_WIDTH - width) / 2,
        y: 100 + onThisPage * 24,
        width,
        height,
      }];
    });
  }

  // Confirming a drawing both stores it and drops a first copy on the page the
  // reader is looking at, so the result is immediately visible and draggable
  // without a second click.
  //
  // `dataUrl` is handed straight to addPlacement rather than being read back
  // out of state on the next line: setSignature has only queued a re-render,
  // and `signature` in this scope is still whatever it was before.
  //
  // Awaited even though nothing follows: an unawaited promise that rejects
  // becomes an unhandled rejection, and awaiting hands that failure to whoever
  // called this instead of dropping it on the floor.
  async function handleConfirmSignature(dataUrl: string) {
    setSignature(dataUrl);
    setIsPadOpen(false);

    await addPlacement(dataUrl, visiblePage);
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

  /**
   * Compose the signed PDF and hand it to the browser as a download.
   *
   * The export comes in two halves. exportSignedPdf() does the maths and
   * returns bytes, knowing nothing about a browser; this function does the part
   * that only means anything inside a page. Nothing else in the app calls
   * document.createElement, and keeping it cornered here is what leaves the
   * other half testable without one.
   */
  async function handleExport() {
    // The button is disabled without both of these, but TypeScript does not
    // read the disabled prop: here the ref is still `ArrayBuffer | null` and
    // `signature` is still `string | null`. This line is what narrows them.
    const bytes = originalBytesRef.current;
    if (!bytes || !signature) return;

    // The only await in the function; everything below is synchronous.
    const signedBytes = await exportSignedPdf(bytes, signature, placements, DISPLAY_WIDTH);

    // A Blob is bytes plus a MIME type — the browser's idea of a file. Its
    // first argument is a list of chunks, which is why a single one still comes
    // wrapped in an array. The copy through `new Uint8Array` is not caution:
    // save() is typed Uint8Array<ArrayBufferLike>, which admits a
    // SharedArrayBuffer, and Blob refuses those; re-wrapping hands it a view
    // that is plainly ArrayBuffer-backed.
    const blob = new Blob([new Uint8Array(signedBytes)], { type: 'application/pdf' });

    // A `blob:` URL is a handle on that memory, meaningful only in this page.
    // Downloads and <a href> speak URLs, not objects, so this is the required
    // adapter — and one more resource the app allocates and has to give back.
    const url = URL.createObjectURL(blob);

    // The standard way to start a download from script: an anchor that is never
    // added to the document. The `download` attribute is the whole trick — with
    // it the browser saves the URL, without it it navigates there instead.
    const link = document.createElement('a');
    link.href = url;
    const base = fileName?.replace(/\.pdf$/i, '') ?? 'document';
    link.download = `${base}signed.pdf`;
    link.click();

    // click() has already handed the URL to the download machinery, and did so
    // synchronously, so releasing it on the next line is safe. It is also the
    // only thing standing between ten exports and ten entire PDFs pinned in
    // memory until the page is reloaded.
    URL.revokeObjectURL(url);
  }


  return (
    <div className="min-h-screen bg-neutral-100">
      <header ref={headerRef} className='sticky top-0 z-10
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
            form control it names, and a nested button would be a second one.

            Disabled until a document is open, because a signature confirmed
            with nothing on screen would be placed on a page that does not
            exist — invisible, and cleared again by the next file anyway. */}
        <button
          type='button'
          disabled={!pdfDoc}
          onClick={() => setIsPadOpen(true)}
          className={BUTTON_CLASS}>
          Sign
        </button>
        {/* Places another copy of the signature the user already drew, so the pad
          only has to be opened once. Disabled rather than hidden when there is
          nothing to place: a control that appears and disappears makes the
          header jump, and a greyed-out button still says the feature exists. */}
        <button
          type='button'
          disabled={!signature || !pdfDoc}
          // `signature &&` is not redundant with `disabled` — TypeScript does not
          // read the disabled prop, so here it still sees `string | null`. The
          // guard is what narrows the type; the prop is what guards the click.
          onClick={() => signature && addPlacement(signature, visiblePage)}
          className={BUTTON_CLASS}
        >
          Place on this page
        </button>

        {/* Turns the placements back into a file. Disabled without a document
            or a signature, which is as far as the check goes: with every
            placement deleted the export still runs and simply writes the
            document back out unchanged — harmless, if a little pointless. */}
          <button
            type='button'
            disabled={!pdfDoc || !signature}
            onClick={handleExport}
            className={BUTTON_CLASS}
          >
            Export
          </button>

        {fileName && <span className="text-sm text-neutral-500">{fileName}</span>}
        {/* visiblePage is a zero-based index, so it is shown +1: page numbers
            are for people. `tabular-nums` gives the digits a fixed width, so
            nothing beside them shifts when 9 rolls over to 10. */}
        {pdfDoc && (
          <span className='text-sm tabular-nums rounded-md text-neutral-500 border p-1 border-neutral-300'>
            {visiblePage + 1} / {pdfDoc.numPages}
          </span>
        )}
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
      {/* The element useVisiblePage searches. It only needs an ancestor of the
          pages, and this one already exists — no wrapper was added for it. */}
      <div ref={pagesRef} className='flex flex-col items-center gap-6 p-8'>
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
