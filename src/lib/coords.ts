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
 * Convert one placement into the rectangle pdf-lib should draw.
 *
 * Two units meet here, and confusing them fails silently:
 *
 * - `placement` — lengths in page widths, origin at the page's top-left, y
 *   growing down. See Placement.
 * - `pageWidth` / `pageHeight` — the page in points, from page.getSize().
 *
 * Multiplying by `pageWidth` is what turns a length in page widths into a
 * length in points. It is the right multiplier for `pdfH` as well, even though
 * that is a vertical measurement, because Placement measures both axes against
 * the width — that is the whole of the unit's definition, and the single most
 * likely thing to get wrong in this file. `pageHeight` appears exactly once,
 * and only as the origin of the y flip.
 *
 * The y line does two things at once: `pageHeight - y * pageWidth` flips the
 * axis so it grows upwards, and subtracting `pdfH` walks from the image's top
 * edge down to its bottom one, because drawImage's `y` names the bottom of the
 * image where CSS `top` names the top.
 *
 * There is no `scale` any more, and no division. It used to take one — CSS
 * pixels per point — because a placement was stored in the pixels of a canvas
 * fixed at 800 wide, so this function had to know how big that canvas was. A
 * unit expressed in the page's own terms removes the question: the conversion
 * is now between two descriptions of the same page rather than between a page
 * and a screen.
 *
 * Corner checks: (0, 0) gives pdfY = pageHeight - pdfH, flush with the top of
 * the page; a placement resting on the bottom edge gives pdfY = 0; and
 * width = 1 gives pdfW = pageWidth, one page across, which is the unit's
 * definition falling out of the arithmetic.
 *
 * Rotated pages (/Rotate ≠ 0) are not handled — see ARCHITECTURE.md. Note that
 * `pageWidth` here is getSize().width, which on a rotated page is not the edge
 * the reader saw; that mismatch is precisely what Milestone 6 has to resolve.
 */
export function placementToPdfRect(
    placement: Placement,
    pageWidth: number,
    pageHeight: number,
): PdfRect {

    const {x, y, width, height} = placement;

    const pdfW = width * pageWidth;
    const pdfH = height * pageWidth;

    const pdfX = x * pageWidth;
    const pdfY = pageHeight - y * pageWidth - pdfH;

    return {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH
    };
}