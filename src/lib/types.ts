/**
 * Shared data shapes.
 *
 * Kept in their own module so that views and the export code can both import
 * them without importing each other.
 */

/**
 * One signature placed on one page.
 *
 * Coordinates are CSS pixels relative to the top-left corner of that page's
 * rendered canvas — the same unit react-rnd reports, and the same unit
 * getDisplayScale() is expressed in. Never device pixels: Milestone 4 divides
 * these by that scale to get PDF points, and the two must agree.
 */
export interface Placement {
    id: string;
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
}