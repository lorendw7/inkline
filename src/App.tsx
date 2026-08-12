import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describeLoadError, loadPdf } from './lib/pdf'
import { PdfPage } from './components/PdfPage'
import { SignaturePadModal } from './components/SignaturePadModal'
import type { Placement } from './lib/types'
import { loadImageSize } from './lib/image'
import { Rnd } from 'react-rnd'
import { useVisiblePage } from './hooks/useVisiblePage'
import { describeExportError, exportSignedPdf } from './lib/export'
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from 'react'





/**
 * The widest a page is ever drawn, in CSS pixels. A narrow window gets its own
 * width instead — see the ResizeObserver below.
 *
 * A ceiling rather than the width, which is the whole of the mobile fix: a
 * phone is 390 across and used to be handed 800 regardless, so a page hung off
 * both edges of the screen. And a ceiling rather than "always fill the
 * window", because a page stretched across a 2560px monitor is a line of text
 * too long to read.
 *
 * Purely a view decision now. It used to be two things at once — how wide to
 * draw a page, and the unit placements were stored in — and the second job is
 * why the export had to be handed this number to do its maths. Placement is in
 * page widths today, so this constant reaches exactly one place: the pixels
 * react-rnd is given and reports back, through toPx/toFraction below.
 */
const MAX_DISPLAY_WIDTH = 800;

/**
 * Initial width of a placed signature, as a fraction of the page's width — a
 * bit under a quarter of it, whatever the page and whatever the screen.
 *
 * Only the width is a constant: the height follows from the image's own aspect
 * ratio, so a wide scrawl and a tall one both keep their proportions.
 */
const SIGNATURE_WIDTH = 0.225;

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

  // The placement the user has picked out, or null for none.
  //
  // It used to be set on drag start and cleared on drag stop, which made it a
  // record of "what is the hand on right now" — true for the length of a
  // gesture and null the rest of the time. That is a different thing from a
  // selection, and the name `activeId` was vague enough to hide the difference:
  // a key pressed after the mouse comes up would have found nothing there.
  //
  // Now it survives the gesture, and the two things it drives — the border and
  // the delete button — are what tell the reader which placement a command
  // would act on. It is cleared by pressing on the page rather than on a
  // signature, by picking another, by deleting this one, and by opening a
  // different document.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A finished sentence to show the reader, or null for "nothing is wrong".
  // Deliberately a string and not the error object: what went wrong is decided
  // in whichever lib module owns the library that failed — pdf.ts for opening,
  // export.ts for saving — and only the wording travels up here. Nothing in the
  // UI ever branches on which failure it was, which is exactly why gaining a
  // second source of failures cost this component almost nothing: one more
  // describe* call at one more catch site, and the banner below never noticed.
  const [error, setError] = useState<string | null>(null);

  // Whether an export is in flight. Two jobs at once, and the second is the
  // one that matters: it tells the reader something is happening, and it holds
  // the Export button shut while it does. Without the latter, a slow document
  // invites the impatient third click and composes the whole file three times.
  const [isExporting, setIsExporting] = useState(false);

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

  // How wide to draw a page right now, in CSS pixels: whatever the container
  // has room for, capped at MAX_DISPLAY_WIDTH. Starts at 0, which reads as
  // "not measured yet" — a real width only exists after the browser has laid
  // the container out, which is why this cannot be computed during render.
  //
  // State and not a ref, unlike the two refs around it: this number *is* on
  // screen. Every canvas is rendered at it and every overlay is positioned
  // through it, so a change has to re-render. That is the whole distinction —
  // a ref for what only other code reads, state for what the picture depends
  // on.
  const [pageWidth, setPageWidth] = useState(0);

  // The one subscription that makes the document responsive. It watches the
  // container rather than the window, so it is right for reasons the window
  // would only be right by accident: a sidebar, a wider gutter, or the phone
  // being turned all change this box, and only some of them change the window.
  //
  // `contentRect.width` is the *content* box — padding excluded — which is
  // exactly the space a page may occupy, given the container's own `p-8`. That
  // it is the wrong measurement for the header effect below and the right one
  // here is not inconsistency: there the padding is part of the strip being
  // hidden, here it is not part of the room being offered.
  //
  // `?? 0` and not `|| 0` on the same principle as everywhere else in this
  // file: 0 is a legitimate width, and `||` cannot tell it from missing.
  //
  // Empty deps, as always for an effect that establishes a listener — the
  // listener re-runs, the effect does not. And the observer fires once on
  // observe(), so the first real width arrives without waiting for a resize
  // that may never come.
  useEffect(() => {
    const container = pagesRef.current;
    if (!container) return;

    const observer = new ResizeObserver(entries => {
      const available = entries[0]?.contentRect.width ?? 0;
      setPageWidth(Math.min(available, MAX_DISPLAY_WIDTH));
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

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
  // This measured once, on the stated assumption that the header could never
  // change height. `flex-wrap` ended that: on a narrow screen the buttons fall
  // onto a second row and the header grows by one. Two things read this number
  // and both would have been quietly wrong — the observer that decides which
  // page you are looking at, and the `top` of the error banner, which would
  // have slid up behind the header it is supposed to sit below.
  //
  // The empty dependency array survived the change and now says something
  // different. It used to mean "measure once and trust it"; it now means "set
  // up one subscription", and the subscription is what answers every later
  // question. An effect that establishes a listener almost always has empty
  // deps — the listener, not the effect, is what re-runs.
  //
  // getBoundingClientRect() inside the callback rather than the entry's
  // contentRect: contentRect is the *content* box and excludes padding and
  // border, which here is py-3 and a bottom border — 25px of header that would
  // silently stop being accounted for. Changing the mechanism is not a licence
  // to change the measurement.
  //
  // useEffect rather than useLayoutEffect: the number never reaches the screen,
  // it only configures the observer, so there is no flicker to race against and
  // no reason to block paint. The cost is one throwaway pass — the observer is
  // built with an offset of 0, then this state lands and it is rebuilt with the
  // real number, before the user could have scrolled anywhere.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const observer = new ResizeObserver(() => {
      setHeaderHeight(header.getBoundingClientRect().height);
    });
    observer.observe(header);


    return () => observer.disconnect();
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

  /**
   * Open the file the user picked, or say why that did not work.
   *
   * Every failure here used to be silent. An `async` handler's exceptions do
   * not escape into the click that started it: they become the rejection of the
   * promise it returns, and React discards that promise unread. The result was
   * a console warning and a screen that did not move — so a try/catch is not
   * tidiness, it is the only thing standing between a bad file and no feedback
   * at all.
   */
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    // Pinned once, then used for the rest of the function. The element is what
    // the `finally` below needs, and by then two awaits have passed; naming it
    // here means nothing downstream has to reason about how long a React
    // synthetic event stays valid.
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return; // the dialog was opened and cancelled

    // Before the first await, so a stale message clears the instant the user
    // picks something rather than when the read finishes.
    setError(null);
    try {
      const bytes = await file.arrayBuffer();
      const doc = await loadPdf(bytes);

      // Stored only after loadPdf has succeeded: if parsing throws, execution
      // never reaches this line, and the ref still holds the bytes of the
      // document that is still on screen — the two can never disagree.
      originalBytesRef.current = bytes;

      // A new document invalidates everything tied to the old one: a placement
      // names a page index that may not exist here, and selectedId names a
      // placement that is about to be dropped. React batches every setState in
      // this function into a single re-render — even after an await — so there is
      // no frame where the new pages are on screen under stale overlays.
      setPlacements([]);
      setSelectedId(null);

      // Storing the document re-renders App, which mounts one PdfPage per page.
      setPdfDoc(doc);
      setFileName(file.name);
      // Nothing here rolls anything back, because nothing was changed until it
      // could not fail: `bytes` and `doc` both exist before the first
      // assignment above. A throw lands below with the previous document still
      // whole and still on screen.
    } catch (err) {
      // Two audiences, two channels. The console keeps the error object, stack
      // and all; the banner gets a sentence, and lib/pdf.ts is what decides
      // which one — see describeLoadError.
      console.error(err);
      setError(describeLoadError(err));
    } finally {
      // A file input fires `change` only when its value changes, so picking the
      // same file twice in a row is silence — which is exactly what someone
      // does after being told the file is broken and assuming they misclicked.
      // Emptying it makes the next pick a change again, whichever way this one
      // ended.
      input.value = '';
    }

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
    // Unchanged by the move to page widths, and that is the point: an aspect
    // ratio is dimensionless, so `width × ratio` holds in whatever unit width
    // happens to be in. It would not have survived measuring x against the
    // page's width and y against its height — the ratio would have had to be
    // corrected by the page's own proportions first.
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
        // Centring is (page − signature) ÷ 2, and a page is 1 page wide. The
        // literal is the unit's definition stated in code: whatever else these
        // numbers mean, 1 is one full page width.
        x: (1 - width) / 2,
        // An eighth of a page down, each further copy another 0.03 lower —
        // the 100px and 24px this used to say, divided by the 800 they were
        // measured against.
        y: 0.125 + onThisPage * 0.03,
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
   * Clearing selectedId matters more than it used to. It no longer goes null
   * on its own at the end of a gesture, so a deleted placement's id would sit
   * in there indefinitely, naming nothing and highlighting nothing.
   */
  function removePlacement(id: string) {
    setPlacements(prev => prev.filter(p => p.id !== id));
    setSelectedId(null);
  }

  /**
   * Let go of the selection when the press lands on the page instead of on a
   * signature.
   *
   * Selecting has three ways out already — pick another, delete this one, open
   * a different file — but all three are something else the user wanted, done
   * on the way. This is the only one that means "I am finished with it", and
   * without it a blue border and a delete button stay on screen for good.
   *
   * The handler sits on the container and therefore hears the press that
   * selected a signature a moment earlier, on its way up: mousedown fires at
   * the element it hit and then again at every ancestor. Clearing
   * unconditionally would undo every selection in the same click that made it.
   *
   * So it asks the only question that actually matters — did this press land
   * inside a signature? — and closest() answers it by walking up from the
   * element that was hit. Which makes the ordering irrelevant: the answer is
   * about the shape of the DOM, not about who ran first. The alternative,
   * stopping propagation inside <Rnd>, would have bought the same behaviour at
   * the price of depending on how react-rnd forwards its events.
   *
   * `signature-overlay` styles nothing. It is a handle for this query, in the
   * same spirit as `no-drag` two dozen lines below — a class is simply where
   * the DOM lets you write down a fact about an element.
   *
   * mousedown and not click, because selecting happens on mousedown too, and
   * the two halves of one idea should not land half a gesture apart. A click
   * also requires press and release on the same element, so pressing on blank
   * space and drifting a few pixels would silently fail to deselect.
   *
   * `instanceof` rather than a cast: EventTarget has no closest(), and an
   * assertion would only hide that from the compiler, not from the browser.
   * `Element` rather than `HTMLElement` because that is where closest() is
   * defined, and SVG elements are Elements too.
   */
  function handleBackgroundMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('.signature-overlay')) {
      return;
    }
    setSelectedId(null);
  }

  /**
   * The one border crossing between the two units in this app.
   *
   * Placement is measured in page widths everywhere — in state, in the export,
   * in the file if it were ever saved. react-rnd is the single component
   * that cannot speak that language: it positions and sizes in CSS pixels and
   * reports gestures back the same way. So values are multiplied on the way in
   * and divided on the way out, and nowhere else.
   *
   * Named rather than written inline as `p.x * pageWidth`, for two reasons. A
   * multiplication and a division look nearly identical, and using the wrong
   * one produces no error at all — only a signature in the wrong place; the
   * names carry the direction so it cannot be applied backwards. And this is
   * the seam a responsive page width plugged into: `pageWidth` stopped being a
   * constant and these two lines are all that had to know, rather than six
   * expressions scattered through the JSX below.
   *
   * Declared during render rather than memoised, because both close over
   * `pageWidth` and would need re-making every time it changed anyway. The
   * cost is two function objects per render; the alternative is a dependency
   * array that is wrong the day someone forgets to update it.
   *
   * Division by zero is not guarded here. It cannot happen: no <Rnd> is
   * mounted until `pageWidth > 0`, and toFraction is only ever called from one
   * of its gesture handlers. The gate is in the JSX below, deliberately — a
   * guard here would silently return Infinity, where a component that does not
   * exist yet cannot report anything at all.
   */
  const toPx = (fraction: number) => fraction * pageWidth;
  const toFraction = (px: number) => px / pageWidth;

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
    setError(null);
    setIsExporting(true);

    try {
      // The only await in the function; everything below is synchronous.
      const signedBytes = await exportSignedPdf(bytes, signature, placements);

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
      // The suggested name, derived so the download sits next to its original in
      // a folder: contract.pdf becomes contract-signed.pdf. The regex is anchored
      // with `$` and case-insensitive, so only a real trailing extension goes —
      // pdf-notes.pdf keeps the word in the middle. `?? 'document'` covers the
      // case that cannot currently happen, a file open with no name recorded.
      const base = fileName?.replace(/\.pdf$/i, '') ?? 'document';
      link.download = `${base}-signed.pdf`;
      link.click();

      // click() has already handed the URL to the download machinery, and did so
      // synchronously, so releasing it on the next line is safe. It is also the
      // only thing standing between ten exports and ten entire PDFs pinned in
      // memory until the page is reloaded.
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError(describeExportError(err));
    } finally {
      setIsExporting(false);
    }
  }


  return (
    <div className="min-h-screen bg-neutral-100">
      {/* `flex-wrap` is the whole mobile story for this row: a flex container
          defaults to nowrap and would rather squash its children than let them
          onto a second line, which on a phone means four buttons fighting over
          390 pixels. Letting it wrap is also what forced the measurement above
          to become a ResizeObserver — the height of this element stopped being
          a constant the moment this class was added.

          The unprefixed values are the phone; `sm:` overrides them from 640px
          up. That order is not a style preference — an unprefixed utility has
          no media query, so it is the only one that can serve as the base. */}
      <header ref={headerRef} className='sticky top-0 z-10
      flex flex-wrap items-center gap-2 sm:gap-4 border-b border-neutral-200 bg-white px-4 sm:px-6 py-3'>
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
          {/* The label is the longest thing in the header and the first to
              cause trouble on a phone, but CSS cannot rewrite text — so both
              versions are in the markup and one is hidden. Exactly one is
              displayed at any width: the short one has no base display of its
              own and simply goes away from 640px up, the long one starts
              hidden and is switched back on there.

              `hidden` and not `opacity-0` or `sr-only`, because display:none
              is the only one of the three that also removes the element from
              the accessibility tree. With either of the others a screen reader
              would read the label twice. Note `sm:inline` rather than
              sm:block — restoring a display means restoring the one the
              element started with, which for a <span> is inline. */}
          <span className='sm:hidden'>Place</span>
          <span
            className='hidden sm:inline'
          >Place on this page</span>
        </button>

        {/* Turns the placements back into a file. Disabled without a document
            or a signature, which is as far as the check goes: with every
            placement deleted the export still runs and simply writes the
            document back out unchanged — harmless, if a little pointless. */}
        <button
          type='button'
          disabled={!pdfDoc || !signature || isExporting}
          onClick={handleExport}
          className={BUTTON_CLASS}
        >
          {isExporting ? 'Exporting…' : 'Export'}
        </button>

        {/* `truncate` is three declarations at once — nowrap, overflow hidden,
            ellipsis — and none of them can do anything without a width to
            overflow, which is what max-w-40 supplies. The pair is the unit; a
            lone `truncate` is the most common way to write nothing at all. */}
        {fileName && <span className="max-w-40 truncate text-sm text-neutral-500 sm:max-w-none">{fileName}</span>}
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
              className='sm:ml-auto h-8 rounded border border-neutral-200 bg-white' />
          )
        }
      </header>
      {/* Pinned to the viewport rather than sitting in the page, because the
          reader is not always at the top of it. That used to be a safe
          assumption: the only failure was a file that would not open, and
          nobody has scrolled anywhere when there is no document. Export broke
          it — it happens on page five, after the signature is in place, and a
          banner two thousand pixels above the fold reports nothing to anyone.

          `fixed` and not `sticky`, for three reasons in increasing order of
          how much they would hurt. It must not occupy layout space, or the
          pages jump down under the reader's hands the moment it appears. It
          must not be able to change the header's height — that used to be
          load-bearing, back when the height was measured once; the header's
          own ResizeObserver has since made it merely undesirable, since a
          banner that pushed the header taller would now shove every page down
          with it. And it must not add a strip of viewport that IntersectionObserver
          does not know about, or the page counter starts lying early again —
          the very bug headerHeight exists to prevent, one layer down.

          `top` is an inline style because Tailwind never runs this code: it
          scans the source for literal class names, so a value only known at
          runtime cannot be a class at all. The gap below the header stays a
          class (`mt-4`) precisely because it is the opposite kind of number —
          a design constant, not a measurement, and it should not be buried
          inside an expression that looks like coordinate maths.

          `role="alert"` makes this an assertive live region: a screen reader
          announces it the moment the node appears, which is why the whole
          element is conditional rather than always present and sometimes
          empty — a live region that was already there may never be read.

          Nothing dismisses itself. A toast that fades is fine for success and
          hostile for failure: look down at the keyboard for three seconds and
          the only account of what went wrong is gone. */}
      {
        error && (<div role='alert'
          style={{ top: headerHeight }}
          className='fixed left-1/2 z-20 -translate-x-1/2 w-[min(90vw,36rem)] flex items-center gap-3
          mt-4 px-4 py-3 rounded-md border border-red-200 bg-red-50 text-red-800 
          text-sm shadow-lg'>
          <span>
            {error}
          </span>
          <button
            type='button'
            onClick={() => setError(null)}
            aria-label='Dismiss'
            className='ml-auto rounded px-2 text-lg leading-none hover:bg-red-100'>
            ×
          </button>
        </div>)
      }
      {/* The element useVisiblePage searches. It only needs an ancestor of the
          pages, and this one already exists — no wrapper was added for it.

          It now earns a second job for the same reason: being an ancestor of
          every page and every overlay is exactly what a press has to bubble
          through, so this is where "was that press on a signature or on the
          page?" can be asked once for all of them.

          It is also the box the ResizeObserver above measures, which is why
          `p-8` is more than decoration: contentRect subtracts it, so the
          padding is what keeps a page off the window's edges on a phone.

          `items-center-safe` was the answer to a page being wider than this
          box — a fixed 800px page on a 390px phone. Plain centering would
          still centre it, half the overflow to the right and half to the left,
          and only the right half is reachable, because a scrollable area never
          extends past its own origin; the left edge of the page would be
          unreachable rather than merely off-screen. `safe` means "centre
          unless that overflows, otherwise align to start", so the overflow all
          lands on one side and scrolling can get to it.

          The real fix arrived afterwards and is one line up: a page is now
          drawn at the width this box actually has, so nothing overflows and
          this class never fires. Kept anyway, because it costs nothing when
          idle and the invariant it protects is not written down anywhere —
          the day a minimum width, a zoom control, or a wide landscape page
          reintroduces the overflow, the failure it prevents is silent. */}
      <div ref={pagesRef} onMouseDown={handleBackgroundMouseDown} className='flex flex-col items-center-safe gap-6 p-8'>
        {
          // `pageWidth > 0` is not a second empty-state check, it is a
          // "wait one frame" check. On the very first render the container has
          // not been laid out, so the observer has not reported anything and a
          // page drawn now would be drawn at zero — a wasted pdf.js render and
          // a division by zero waiting in toFraction. The condition falls false
          // for a single frame at most, before any document can be open.
          pdfDoc && pageWidth > 0 ? (
            Array.from({ length: pdfDoc.numPages }, (_, index) => (
              <PdfPage key={index} pageNumber={index + 1} pdfDoc={pdfDoc} displayWidth={pageWidth}>
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
                        position={{ x: toPx(p.x), y: toPx(p.y) }}
                        size={{ width: toPx(p.width), height: toPx(p.height) }}
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
                        className={`signature-overlay group border-2 ${selectedId === p.id ? 'border-blue-500' : 'border-transparent'}`}
                        // Selection, not a gesture flag: the stop handlers
                        // below deliberately do not clear it. react-draggable
                        // fires onStart on mousedown, before any movement, so
                        // a plain click runs through here too — which is how
                        // click-to-select works without a click handler.
                        onDragStart={() => setSelectedId(p.id)}
                        // `data` already carries the new top-left corner.
                        onDragStop={(_e, data) => {
                          updatePlacement(p.id, { x: toFraction(data.x), y: toFraction(data.y) });
                        }}
                        onResizeStart={() => setSelectedId(p.id)}
                        // Position is patched alongside size because a top or left
                        // handle pins the opposite corner and moves the origin.
                        // Size is read off the element rather than from `_delta`,
                        // which is only the change; parseFloat turns Rnd's
                        // "213.5px" into a number without rounding it.
                        onResizeStop={(_e, _dir, ref, _delta, position) => {
                          updatePlacement(p.id, {
                            width: toFraction(parseFloat(ref.style.width)),
                            height: toFraction(parseFloat(ref.style.height)),
                            x: toFraction(position.x),
                            y: toFraction(position.y)
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
                          and it earns its keep twice over: react-draggable
                          returns early when mousedown lands on a match, so
                          clicking this button neither drags the signature nor
                          selects it. Delete is all that happens.

                          Three ways to reveal it, and only the first is a
                          ternary. The selected placement keeps its button
                          showing, because a selection the reader cannot act on
                          is only decoration; `group-hover` pairs with `group`
                          on the Rnd box so hovering any signature fades its
                          own in; `focus-visible` does the same for keyboard
                          users, who would otherwise land on a button they
                          cannot see — and it is focus-visible rather than focus
                          so a mouse click does not leave the button stuck on.

                          The base opacity has to live *inside* the ternary
                          rather than beside it. Two utilities for one property
                          at equal specificity are settled by their order in
                          the generated stylesheet, which is Tailwind's to
                          decide, not this file's. */}
                        <button
                          type='button'
                          className={`no-drag absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs leading-none text-white ${selectedId === p.id ? 'opacity-100' : 'opacity-0'}  transition-opacity
                          group-hover:opacity-100 focus-visible:opacity-100`}
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
          ) : (
            /*
             * Both halves of "nothing is open yet": the empty state that keeps
             * the page from being a blank grey rectangle, and the only place a
             * first-time visitor is told what the four header buttons do.
             *
             * Written as plain text with no second "Open PDF" control, on
             * purpose. The header's file picker is a <label> wrapped around an
             * <input>, so a copy of it here would be a second input with its
             * own wiring — worth extracting into a component one day, but not
             * worth duplicating. And a button-shaped thing that does nothing
             * when clicked is worse than a sentence that never pretended.
             */
            <section className='mt-24 w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6'>
              <h2 className='text-base font-semibold'>Sign a PDF without uploading it</h2>
              <p className='mt-2 text-sm text-neutral-600'>
                Everything happens in this tab. Your document never leaves your machine.
              </p>
              <ol className='mt-4 list-decimal space-y-1 pl-5 text-sm text-neutral-600 marker:text-neutral-400'>
                <li>
                  <span className='font-medium text-neutral-900'>Open PDF</span> — pick a file to work on.
                </li>
                <li>
                  <span className='font-medium text-neutral-900'>Sign</span> — draw your signature and confirm it.
                </li>
                <li>
                  <span className='font-medium text-neutral-900'>Place on this page</span> — drop another copy on the page you are looking at, then drag or resize it.
                </li>
                <li>
                  <span className='font-medium text-neutral-900'>Export</span> — download the signed PDF.
                </li>
              </ol>
            </section>
          )
        }
      </div>
      {
        isPadOpen && <SignaturePadModal onClose={() => setIsPadOpen(false)} onConfirm={handleConfirmSignature} />
      }
    </div>
  )
}

export default App;
