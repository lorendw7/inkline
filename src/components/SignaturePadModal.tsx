import { useEffect, useRef } from "react"
import SignaturePad from "signature_pad"
import { useDevicePixelRatio } from "../hooks/useDevicePixelRatio"


// Beyond 3x the bitmap area costs real memory for no visible gain. Same reason
// and same value as in PdfPage.
const MAX_DPR = 3;

interface SignaturePadModalProps {
    /** Called when the user dismisses the modal. */
    onClose: () => void
}

/**
 * Modal for drawing a signature.
 *
 * Deliberately holds no open/closed state of its own: the parent decides
 * whether to render it, and hears about dismissal through `onClose`. Keeping
 * that decision in one place is what lets the parent gate it on other state
 * later — refusing to open before a document is loaded, for instance.
 *
 * It does own the signature_pad instance, whose lifetime is tied to the canvas
 * element: created once the element exists, torn down when it goes away. React
 * renders the shell; the library owns everything inside the canvas.
 */
export function SignaturePadModal({ onClose }: SignaturePadModalProps) {
    // Two refs, two different reasons. canvasRef reaches the real DOM element;
    // padRef holds the library instance, which has to survive re-renders but
    // must not cause one when it changes — that is what separates it from state.
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePad | null>(null);
    const dpr = Math.min(useDevicePixelRatio(), MAX_DPR);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Size the bitmap at device resolution. offsetWidth/Height report the
        // CSS pixels the element occupies after layout, which the `w-full h-48`
        // classes decide.
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;

        // signature_pad draws in CSS coordinates and knows nothing about pixel
        // density, so the context scales every drawing operation on its behalf.
        // This has to come after the sizing above: assigning canvas.width resets
        // the context transform.
        canvas.getContext("2d")?.scale(dpr, dpr);

        // No backgroundColor, deliberately. The visible tint comes from the CSS
        // `bg-neutral-50` class, which is painted behind the bitmap and never
        // reaches toDataURL(). The exported PNG has to stay transparent so the
        // signature composites onto the page rather than covering it.
        const pad = new SignaturePad(canvas, {
            penColor: '#171717',
            minWidth: 1,
            maxWidth: 2.5
        });

        padRef.current = pad;

        // signature_pad registers pointer listeners on the canvas; off() removes
        // them. Same contract as any addEventListener: whoever subscribes is
        // responsible for unsubscribing.
        return () => {
            pad.off();
            padRef.current = null;
        }

    }, [dpr]);

    // What is drawn lives in the pad instance, not in React state, so clearing
    // it changes nothing React renders — no re-render is needed or wanted.
    function handleClear() {
        padRef.current?.clear();
    }

    return (
        // Two layers. The outer one is fixed to the viewport: it dims whatever
        // is behind, catches clicks meant for the page, and centres the panel.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            {/* `w-full max-w-lg` keeps the panel a fixed width on a desktop but
                lets it shrink on a narrow screen. */}
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold">Draw your signature</h2>
                <canvas
                    ref={canvasRef}
                    className="block h-48 w-full touch-none rounded-md border border-neutral-300 bg-neutral-50"
                />

                <div className="mt-4 flex jutify-end gap-2">
                    <button
                        type="button"
                        onClick={handleClear}
                        className="
                        mr-auto
                        rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                    >
                       Clear
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    )
}