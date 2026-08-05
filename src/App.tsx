import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from './lib/pdf'
import { PdfPage } from './components/PdfPage'



/**
 * Every page is rendered at this width in CSS pixels, so a single constant
 * fixes the scale for the whole document. Milestone 4 converts overlay
 * coordinates back into PDF points using the same number.
 */
const DISPLAY_WIDTH = 800

/**
 * Owns all app state as plain, serializable data; everything below is a view
 * over it. See docs/ARCHITECTURE.md.
 */
function App() {
  // null until the user picks a file
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);


  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return; // the dialog was opened and cancelled

    const bytes = await file.arrayBuffer();
    const doc = await loadPdf(bytes);

    // Storing the document re-renders App, which mounts one PdfPage per page.
    setPdfDoc(doc);
    setFileName(file.name);
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

        {fileName && <span className="text-sm text-neutral-500">{fileName}</span>}
      </header>
      <div className='flex flex-col items-center gap-6 p-8'>
        {/* Nothing renders before a document is loaded: `null && ...` is null,
            and React renders null as nothing. */}
        {
          pdfDoc &&
          Array.from({ length: pdfDoc.numPages }, (_, index) => (
            <PdfPage key={index} pageNumber={index + 1} pdfDoc={pdfDoc} displayWidth={DISPLAY_WIDTH} />
          ))
        }
      </div>
    </div>
  )
}

export default App;
