/**
 * The one piece of coordinate maths in the project.
 *
 * A pure function in its own module, with no PDF, no canvas and no React in
 * sight, because this is the code that cannot be debugged by looking at it —
 * a wrong sign here still exports a perfectly valid file, with the signature
 * somewhere else. See docs/ARCHITECTURE.md → "The two coordinate systems".
 */
import type { Placement } from "./types";

/**
 * A rectangle in PDF user space: points, origin at the page's bottom-left.
 *
 * Structurally identical to a Placement's x/y/width/height, which is precisely
 * why it is worth its own type — the numbers mean something different, and the
 * name is the only thing that says so. The fields are also exactly the options
 * pdf-lib's drawImage() takes, so the result needs no repacking.
 */
export interface PdfRect {
    x: number;
    y: number;
    width: number;
    height: number;
}


/**
 * Convert one overlay rectangle from screen coordinates to PDF coordinates.
 *
 * Three units meet here, and confusing them fails silently:
 *
 * - `placement` — CSS pixels, origin at the page's top-left, y growing down.
 * - `pageHeight` — the page's height in points, from pdf-lib's page.getSize().
 * - `scale` — CSS pixels per point, the number getDisplayScale() returns. It
 *   must come from the page's CSS width, never from the canvas bitmap width,
 *   which is multiplied by devicePixelRatio.
 *
 * Dividing by `scale` undoes the display zoom. The y line then does two things
 * at once: `pageHeight - y/scale` flips the axis so it grows upwards, and
 * subtracting `pdfH` walks from the image's top edge down to its bottom one,
 * because drawImage's `y` names the bottom of the image where CSS `top` names
 * the top.
 *
 * Corner check: (0, 0) gives pdfY = pageHeight - pdfH, flush with the top of
 * the page; a placement resting on the bottom edge gives pdfY = 0.
 *
 * Rotated pages (/Rotate ≠ 0) are not handled — see ARCHITECTURE.md.
 */
export function placementToPdfRect(
    placement: Placement,
    pageHeight: number,
    scale: number
): PdfRect {

    const {x, y, width, height} = placement;

    const pdfW = width / scale;
    const pdfH = height / scale;

    const pdfX = x / scale;
    const pdfY = pageHeight - y / scale - pdfH;

    return {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH
    };
}