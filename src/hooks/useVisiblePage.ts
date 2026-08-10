import { useEffect, useState } from "react";
import type { RefObject } from "react";

// An IntersectionObserver only calls back when the visible fraction of an
// element crosses one of the thresholds it was given. The default is [0]:
// "tell me when the element enters or leaves the viewport". A page taller than
// the window never fully enters or leaves, so with the default this would fire
// once and then go quiet for the rest of the scroll. Twenty-one evenly spaced
// values — 0, 0.05, 0.10 … 1 — keep the readings coming as a page slides past.
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);


/**
 * Reports which page the reader is looking at: the one showing the most pixels.
 *
 * How it works, in order:
 *
 *   1. Find every page wrapper under `containerRef`. PdfPage marks each one
 *      with a `data-page-index` attribute, so a single querySelectorAll finds
 *      them all and each node carries its own page number.
 *   2. Hand them to one IntersectionObserver. From here the browser does the
 *      geometry: it tracks how much of each element overlaps the viewport and
 *      calls back whenever that overlap crosses one of THRESHOLDS.
 *   3. Each callback writes the visible height of the pages it mentions into
 *      `visibleHeights`, then scans that whole map for the tallest entry.
 *   4. That index goes into state, and the re-render is what makes the header
 *      in App show "3 / 12".
 *
 * The obvious alternative — an onScroll handler calling getBoundingClientRect
 * on every page — answers the same question, but it forces the browser to
 * recompute layout on every single scroll event. The observer runs off the main
 * thread's rendering work instead and only speaks up when something changed.
 *
 * @param containerRef the element the pages live under. One ref for the whole
 *                     list rather than one per page: the pages are found by
 *                     their data-page-index attribute, which also tells the
 *                     hook which page each one is, so nothing here has to be
 *                     kept in the right order by hand.
 * @param pageCount what re-subscribes the observer when the document changes.
 *                  The ref object keeps its identity forever, so it could never
 *                  serve as that trigger — only its contents change.
 *                  Swapping in a document with the *same* page count does not
 *                  re-run the effect, and that is still correct only because
 *                  React reuses the existing wrapper divs rather than building
 *                  new ones. Give PdfPage a document-specific `key` one day and
 *                  this observer would be left watching detached nodes.
 * @param topOffset pixels along the top edge of the viewport that something
 *                  else is covering — here, the sticky header. The hook has no
 *                  business knowing that header exists, so the caller supplies
 *                  the number and the hook only subtracts it.
 */
export function useVisiblePage(
    containerRef: RefObject<HTMLElement | null>,
    pageCount: number,
    topOffset = 0
): number {

    const [visiblePage, setVisiblePage] = useState(0);

    // An observer is a subscription to something outside React: it has to be
    // created, and it has to be destroyed again. That pairing — set up here,
    // tear down in the returned cleanup — is what useEffect is for. It also
    // runs after the DOM has been committed, which is the only time
    // containerRef.current is anything but null.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const elements = container.querySelectorAll('[data-page-index]');
        // Returning early skips the cleanup too, which is correct: nothing was
        // subscribed, so there is nothing to unsubscribe. This is the state on
        // the very first render, before any document is open.
        if (elements.length === 0) return;

        // Visible height per page index, accumulated across callbacks. It has
        // to outlive a single callback: `entries` carries only the pages that
        // just crossed a threshold, never the whole document, so a map built
        // inside the callback would compare two pages and ignore the rest.
        const visibleHeights = new Map<number, number>();

        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                // The callback reports DOM nodes, not page numbers, so each
                // node is made to carry its own. getAttribute rather than
                // dataset because dataset lives on HTMLElement while
                // entry.target is only an Element, so this needs no type
                // assertion. The null branch is unreachable — these nodes were
                // selected by that very attribute — but the DOM signature
                // admits null, and an unchecked one would quietly become NaN.
                const raw = entry.target.getAttribute('data-page-index');
                if (raw === null) continue;
                // Absolute height, not intersectionRatio: pages differ in
                // size, and a fully visible short page would otherwise beat
                // a tall page filling the screen. A page scrolled out of
                // view reports a zeroed rect, so it leaves the running on
                // its own with no bookkeeping here.
                visibleHeights.set(Number(raw), entry.intersectionRect.height);

            }

            // Seeded at -1 rather than 0 because 0 is a legal height: with 0 as
            // the seed, a moment where nothing is visible would never enter the
            // branch and `best` would stay at its declared value by accident
            // rather than by decision.
            let best = 0;
            let bestHeight = -1;
            for (const [index, height] of visibleHeights) {
                // Strict `>` keeps the earlier entry on a tie. A Map iterates in
                // insertion order and re-setting a key does not move it, so the
                // order here is the order of the observer's first callback,
                // which is the order we called observe() in — page order. Ties
                // therefore resolve to the lower page number, which is what a
                // reader stopped at a page boundary expects.
                if (height > bestHeight) {
                    bestHeight = height;
                    best = index;
                }
            }
            // Runs on every callback, most of which do not change the answer.
            // React compares with Object.is and skips the re-render when the
            // number is unchanged, so the redundant calls cost nothing.
            setVisiblePage(best);

            // rootMargin resizes the root's box before any intersection is
            // computed; a negative top margin pushes the viewport's top edge
            // down, so the strip hidden behind the sticky header stops counting
            // as visible. Units are mandatory — a bare 0 is rejected — and the
            // margin is frozen at construction, which is why topOffset has to
            // be a dependency of the effect.
        }, { threshold: THRESHOLDS, rootMargin: `-${topOffset}px 0px 0px 0px` });

        // No null guard: a NodeList only ever holds real nodes. Order does not
        // matter either, because the index rides on each node — the one thing
        // the observer does rely on is that its first callback arrives in this
        // order, which is what settles ties in the scan above.
        for (const element of elements) observer.observe(element);

        // One call unhooks every element. Without it the observer would hold the
        // old page nodes alive and keep setting state for a document that is
        // no longer on screen.
        return () => observer.disconnect();
    }, [containerRef, pageCount, topOffset]);


    // The state is the observer's raw reading; this is the promise made to the
    // caller, and the two are not the same thing. A shorter document shrinks
    // pageCount immediately, while the first callback about it is still an
    // async hop away, so the reading can briefly name a page that no longer
    // exists. Clamping during render is instant and needs no second state —
    // an effect that reset the state would always be one frame late.
    return Math.min(visiblePage, Math.max(pageCount - 1, 0));

}
