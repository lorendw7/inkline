/**
 * Image helpers. Knows nothing about React or PDFs.
 */

/** An image's intrinsic pixel size — the dimensions stored in the file itself. */
export interface ImageSize {
    width: number;
    height: number;
}

/**
 * Read an image's intrinsic size without inserting it into the document.
 *
 * The browser only knows the size once the image has decoded, and it announces
 * that through a callback, so the callback is wrapped in a promise the caller
 * can await.
 */
export function loadImageSize(dataUrl: string): Promise<ImageSize> {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => resolve({width: image.naturalWidth, height: image.naturalHeight});

        image.onerror = () => reject(new Error("The signature image could not be decoded."));

        // Assigned last by convention: the handlers are in place before anything
        // can start loading, so the order never has to be reasoned about.
        image.src = dataUrl;
    });
}