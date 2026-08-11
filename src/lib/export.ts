/**
 * pdf-lib composition — the export half of the app, and the exact counterpart
 * of lib/pdf.ts: that module only ever displays, this one only ever composes.
 *
 * Nothing is read back out of a canvas. The signature goes into the page as a
 * real PDF image and the document itself is never rasterised, so its text stays
 * text and the file stays small.
 */
import { PDFDocument } from 'pdf-lib';
import type { Placement } from './types';
import { placementToPdfRect } from './coords';


/**
 * Build a new PDF with every placed signature drawn into its page.
 *
 * Works from the *original* bytes, not from anything pdf.js holds: the rendered
 * canvases are throwaway pixels, and the document proxy is a remote control for
 * a worker that will not hand its copy back. App keeps the untouched buffer for
 * exactly this call — see originalBytesRef.
 *
 * Returns bytes and touches no DOM, so the download itself — Blob, object URL,
 * a synthetic <a> — stays with the caller. That split is what makes the whole
 * conversion testable without a browser.
 *
 * `displayWidth` is the CSS width every page was rendered at, and it is the
 * bridge back from screen pixels to points. A parameter rather than an import
 * because the constant belongs to the view, and this module has no view.
 *
 * Throws if the bytes are not a readable PDF — an encrypted file among them.
 * What the user is told about that is the caller's decision.
 */
export async function exportSignedPdf(
  originalBytes: ArrayBuffer,
  signatureDataUrl: string,
  placements: Placement[],
  displayWidth: number,
): Promise<Uint8Array> {
    const doc = await PDFDocument.load(originalBytes);

    // Embedded once, deliberately outside the loop. A PDFImage is a handle on
    // bytes now stored in the document, and drawImage may reuse one handle any
    // number of times; embedding per placement would write the same PNG into
    // the file once per copy. embedPng takes the data URL string as it is, so
    // there is no hand-rolled base64 decoding to get wrong either.
    const image = await doc.embedPng(signatureDataUrl);

    // 0-based, which is the numbering Placement.pageIndex already uses. The
    // +1/-1 dance belongs to pdf.js and stops at the display layer.
    const pages = doc.getPages();

    for (const p of placements) {
        const page = pages[p.pageIndex];
        // TypeScript types this as PDFPage with no `undefined` in sight —
        // noUncheckedIndexedAccess is off, so it trusts the index blindly. The
        // guard is for the runtime, not the compiler: one placement naming a
        // page this document does not have would otherwise take the whole
        // export down with it.
        if (!page) continue;

        // Points, not pixels. Recomputed per page because one document may mix
        // page sizes, and a single global scale would then be right for exactly
        // one of them. Same ratio getDisplayScale() computes, asked of pdf-lib
        // rather than pdf.js — the two agree on every unrotated page.
        const {width, height} = page.getSize();
        const scale = displayWidth / width;
        // `height`, not `width`: the axis being flipped is y.
        const rect = placementToPdfRect(p, height, scale);

        // PdfRect's fields are drawImage's options, so the rectangle goes in
        // whole rather than being spelled out field by field.
        page.drawImage(image, rect);
    }

    // No `await`: returning a promise from an async function chains it, and the
    // caller's single await settles both.
    return doc.save();
}
