interface SignaturePadModalProps {
    /** Called when the user dismisses the modal. */
    onClose: () => void
}

/**
 * Modal shell for drawing a signature.
 *
 * Deliberately holds no open/closed state of its own: the parent decides
 * whether to render it, and hears about dismissal through `onClose`. Keeping
 * that decision in one place is what lets the parent gate it on other state
 * later — refusing to open before a document is loaded, for instance.
 */
export function SignaturePadModal({ onClose }: SignaturePadModalProps) {
    return (
        // Two layers. The outer one is fixed to the viewport: it dims whatever
        // is behind, catches clicks meant for the page, and centres the panel.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            {/* `w-full max-w-lg` keeps the panel a fixed width on a desktop but
                lets it shrink on a narrow screen. */}
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold">Draw your signature</h2>
                {/* Placeholder for the signature_pad canvas. */}
                <div className="h-48 rounded-md border border-neutral-300 bg-neutral-50" />

                <div className="mt-4 flex jutify-ends gap-2">
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