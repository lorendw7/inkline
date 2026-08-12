/**
 * Shared data shapes.
 *
 * Kept in their own module so that views and the export code can both import
 * them without importing each other.
 */

/**
 * One signature placed on one page.
 *
 * All four numbers are lengths, measured from the page's top-left corner in a
 * single unit: one **displayed page width**. `x: 0.25` reads as "a quarter of
 * a page-width in from the left edge", `width: 0.5` as "half a page-width
 * across". Multiply by whatever that page happens to measure — 800 CSS pixels
 * on a laptop, 360 on a phone, 595 points inside the file — and the number
 * lands correctly in that space.
 *
 * That is the whole point of the unit: nothing here refers to a screen, so
 * resizing the window, turning a phone, or exporting cannot invalidate a
 * placement. The previous unit was CSS pixels on a canvas fixed at 800 wide,
 * which was only well defined for as long as that 800 never moved.
 *
 * *Displayed* width, precisely: the horizontal edge the reader sees, with
 * /Rotate applied. For an unrotated page that is page.getSize().width; on a
 * page rotated 90 or 270 it is getSize().height instead. Today every page this
 * app will place a signature on is unrotated, so the two coincide and the
 * distinction costs nothing — which is exactly why it is worth pinning down
 * now. Rotation support is a later milestone, and it will need this unit to
 * have meant the displayed edge all along; a definition written when both
 * readings are true is a definition nobody has to re-derive under pressure.
 *
 * These are lengths and not percentages, and `y` and `height` regularly exceed
 * 1: an A4 page is 1.414 page-widths tall, so its bottom edge is at y = 1.414.
 * Clamping any of them to 1 would pin every signature inside the top 70% of
 * the page — a plausible-looking "fix" that breaks everything.
 *
 * Both axes deliberately share the one unit rather than measuring y against
 * the page's height. It keeps a square signature stored as width === height,
 * so shape survives in the numbers themselves; and converting back needs only
 * a page's width, which App already knows, instead of also needing its height,
 * which differs per page and lives inside PdfPage.
 */
export interface Placement {
    id: string;
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
}