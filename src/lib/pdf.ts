/**
 * pdf.js helpers.
 *
 * This module knows nothing about React. It wraps only the pdf.js calls the app
 * needs, and deliberately hands decisions back to the caller — a copy-safe
 * buffer, a reusable scale, a cancellable render task — instead of making them
 * here.
 */
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

// pdf.js parses documents on a Web Worker and needs the URL of that worker
// script. `new URL(..., import.meta.url)` is the form Vite recognises and
// rewrites at build time; a plain string path would 404 in production.
// This runs exactly once — ES modules are evaluated a single time no matter
// how many files import them.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()


/**
 * Parse raw PDF bytes into a document handle.
 *
 * The caller keeps ownership of `bytes`. pdf.js transfers whatever buffer it is
 * given to its worker thread, which leaves the original detached (byteLength 0)
 * on this side — so we pass a copy and the caller's bytes stay readable for
 * pdf-lib at export time.
 */
export async function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
  return loadingTask.promise;
}


/**
 * Scale factor that renders `page` at `displayWidth` CSS pixels.
 *
 * A viewport at scale 1 measures the page in PDF points, so this ratio is the
 * CSS-pixels-per-point factor. The export step converts overlay coordinates
 * back to points with the same number, so it must be based on the CSS width —
 * never on the canvas bitmap width, which may be multiplied by devicePixelRatio.
 */
export function getDisplayScale(page: PDFPageProxy, displayWidth: number): number {
  const baseViewport = page.getViewport({ scale: 1 });
  return displayWidth / baseViewport.width;
}


/**
 * Draw `page` onto `canvas` and return the in-flight render task.
 *
 * Returns the task instead of awaiting it, because the caller needs `cancel()`
 * to abort a render that has been superseded — React re-runs effects, and users
 * switch files mid-render. Awaiting here would swallow that ability.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): RenderTask {
  const viewport = page.getViewport({scale});

  // Sizing the bitmap also sizes the element on screen: a canvas with no CSS
  // width is displayed at its bitmap size.
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // pdfjs-dist v6 prefers `canvas`; `canvasContext` is kept only for backwards
  // compatibility.
  return page.render({canvas, viewport});
}
