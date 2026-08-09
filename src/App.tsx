import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from './lib/pdf'
import { PdfPage } from './components/PdfPage'
import { SignaturePadModal } from './components/SignaturePadModal'
import type { Placement } from './lib/types'
import { loadImageSize } from './lib/image'



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
                  // `absolute` positions this against PdfPage's `relative`
                  // wrapper, so x/y are measured from the page's top-left —
                  // the same origin Placement documents.
                  <img
                    key={p.id}
                    // A placement can only exist after a signature was
                    // confirmed, so this never actually falls back. Milestone 3
                    // proper will give each placement its own image instead.
                    src={signature ?? undefined}
                    // Decorative: the header already shows the signature with a
                    // real label, so announcing it again here is just noise.
                    alt=''
                    className='absolute'
                    // Inline styles, not Tailwind classes: these are runtime
                    // numbers that change as the user drags, and a class name
                    // can only express values known at build time.
                    style={{ left: p.x, top: p.y, width: p.width, height: p.height }}
                  />
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
