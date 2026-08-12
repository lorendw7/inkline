/**
 * pdf-lib composition — the export half of the app, and the exact counterpart
 * of lib/pdf.ts: that module only ever displays, this one only ever composes.
 *
 * Nothing is read back out of a canvas. The signature goes into the page as a
 * real PDF image and the document itself is never rasterised, so its text stays
 * text and the file stays small.
 */
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
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
 * Nothing here refers to a screen, and that is newer than it looks. This used
 * to take a `displayWidth` — the CSS width a page had been drawn at — because
 * placements were stored in the pixels of that drawing and could not be read
 * without it. A pure PDF composer having to be told how wide a browser painted
 * something was always the odd part of this module's signature; measuring
 * placements in page widths instead is what let the parameter go.
 *
 * Throws if the bytes are not a readable PDF — an encrypted file among them.
 * What the user is told about that is the caller's decision.
 */
export async function exportSignedPdf(
  originalBytes: ArrayBuffer,
  signatureDataUrl: string,
  placements: Placement[],
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

        // Points. Asked of every page rather than once, because one document
        // may mix page sizes and a placement means "a fraction of *this*
        // page" — the same 0.5 is a different number of points on A4 and on
        // Letter, which is exactly the property that makes it worth storing
        // that way.
        const {width, height} = page.getSize();
        // Width first. Both arguments are numbers and swapping them compiles
        // perfectly, so this order is worth reading twice.
        const rect = placementToPdfRect(p, width, height);

        // PdfRect's fields are drawImage's options, so the rectangle goes in
        // whole rather than being spelled out field by field.
        page.drawImage(image, rect);
    }

    // No `await`: returning a promise from an async function chains it, and the
    // caller's single await settles both.
    return doc.save();
}

/**
 * Turn an exportSignedPdf() failure into a sentence worth showing a person.
 *
 * The mirror of describeLoadError, and here for the same three reasons: a
 * library's exception classes are an implementation detail, `instanceof`
 * silently returns false when a package is loaded twice through different entry
 * points — so the check has to sit beside the call that produced the error —
 * and err.message is written for developers, not for readers.
 *
 * The encrypted branch is not symmetry for its own sake. pdf.js and pdf-lib
 * disagree about what the word means: pdf.js refuses only a document whose
 * *content* needs a password, while PDFDocument.load refuses any document
 * carrying encryption at all. So a file with an owner password and no user
 * password — the "read this, but do not edit it" kind, which is most of the
 * restricted documents in the world — opens cleanly, renders, accepts a
 * signature, and fails here. Without this branch the user does the entire job
 * and gets back nothing but a silent button.
 */
export function describeExportError(err: unknown): string {
    if (err instanceof EncryptedPDFError) {
        return 'This PDF is protected against editing. Inkline can display it, but cannot write out a signed copy.';
    }
    return 'The signed PDF could not be created. Try another file.';
}
