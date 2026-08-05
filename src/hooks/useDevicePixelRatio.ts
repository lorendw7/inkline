import { useEffect, useState } from "react";


/**
 * The current devicePixelRatio, kept up to date.
 *
 * The ratio changes when the window moves to a different monitor, when the OS
 * display scaling changes, and when the user zooms the browser. Anything that
 * rasterises at device resolution has to redraw when it does, and the platform
 * offers no dedicated event for it — hence the media query below.
 */
export function useDevicePixelRatio(): number {
    const [dpr, setDpr] = useState(window.devicePixelRatio || 1);

    useEffect(() => {
        // A media query pinned to the current ratio stops matching the instant
        // the ratio changes. It can only fire once, so `dpr` is a dependency:
        // the effect re-runs and subscribes to the new ratio, and the cleanup
        // unsubscribes from the old one.
        const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
        // Held in a variable because removeEventListener needs the identical
        // function reference to unsubscribe.
        const handleChange = () => setDpr(window.devicePixelRatio || 1);

        query.addEventListener('change', handleChange);
        return () => query.removeEventListener('change', handleChange);
    }, [dpr]);

    return dpr;
}