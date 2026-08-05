import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { getDisplayScale, renderPage } from "../lib/pdf";


interface PdfPageProps {
    pdfDoc: PDFDocumentProxy
    /** 1-based, as pdf.js expects — not the 0-based index placements will use. */
    pageNumber: number
    /** Target width in CSS pixels; determines the render scale. */
    displayWidth: number
}

/**
 * Renders one PDF page onto its own canvas.
 *
 * Canvas content cannot be described declaratively, so this component uses the
 * two escape hatches React provides: a ref to reach the real element, and an
 * effect to draw into it once that element exists.
 */
export function PdfPage({ pdfDoc, pageNumber, displayWidth}: PdfPageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        // Guards scoped to this run. Every re-run gets a fresh pair, so a stale
        // run can never cancel a newer one.
        let cancelled = false;
        let task: RenderTask | undefined;

        // The effect callback itself cannot be async — it has to return the
        // cleanup function — so the async work lives in a nested function.
        async function draw() {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const page = await pdfDoc.getPage(pageNumber);
            // Awaiting means time has passed and anything may have changed.
            // Always re-check the world after an await.
            if (cancelled) return;

            const scale = getDisplayScale(page, displayWidth);
            task = renderPage(page, canvas, scale);

            try {
                await task.promise;
            } catch {
                // A cancelled render rejects by design — nothing to handle.
            }
        }

        draw();

        // Runs before every re-run and on unmount. Without it, StrictMode's
        // double-invoked effect would put two render tasks on one canvas and
        // pdf.js would throw.
        return () => {
            cancelled = true;
            task?.cancel();
        }
    }, [pdfDoc, pageNumber, displayWidth]);

    return (
        // `relative` makes this wrapper the positioning context for the
        // signature overlays added in Milestone 3. Spacing between pages is the
        // parent container's job, so this card carries no margin of its own.
        <div className="relative overflow-hidden rounded-lg bg-white shadow-md">
            {/* `block` because a canvas is inline by default, which leaves a
                few pixels of baseline gap below it inside the rounded card. */}
            <canvas ref={canvasRef} className="block" />
        </div>
    )
}