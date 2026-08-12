import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Content Security Policy — the "your document never leaves your machine"
 * promise, restated as something the browser enforces rather than something the
 * README asserts.
 *
 * `connect-src 'none'` is the whole point: no fetch, no XMLHttpRequest, no
 * WebSocket, no beacon, from any script on this page. Not from this app, and
 * not from a dependency on the day one of them ships a compromised release —
 * which is the one attack a client-side tool cannot audit its way out of. It
 * also makes the claim checkable by anyone: sign a document with DevTools open
 * and watch the Network panel stay empty.
 *
 * Every other directive is derived from something this app actually does, and
 * the list starts at `default-src 'none'` so that each permission has to be
 * argued for rather than inherited.
 *
 * The separator is `;`, and the distinction is not cosmetic. A `,` separates
 * whole *policies*, and multiple policies intersect rather than merge: the
 * first line would arrive as a complete policy permitting nothing, blocking the
 * bundle, the stylesheet and the worker before the eight permissions below it
 * were ever read. The page renders blank, and nothing in the syntax hints at
 * it, because both characters parse.
 */
const CSP = [
  "default-src 'none'",

  // The production bundle and nothing else. Vite emits one external module
  // script; there is no inline code that would have to be allowed.
  "script-src 'self'",

  // pdf.js parses on a Web Worker. This would fall back to script-src if left
  // out, but naming it records why 'self' is enough: the worker is same-origin
  // only because the script is bundled (see lib/pdf.ts). Pointed at a CDN,
  // pdf.js wraps it in a blob: URL instead, and this line would have to say so.
  "worker-src 'self'",

  // 'unsafe-inline' is unavoidable here: react-rnd drags an element by writing
  // to its style attribute, and the sticky header sets `style={{ top }}`. It
  // reads worse than it is — an inline *script* can exfiltrate, an inline
  // *style* can only lie about appearance, and the url() it would need to
  // smuggle anything out is refused by every other directive in this list.
  "style-src 'self' 'unsafe-inline'",

  // Icons are 'self'. The signature is the data: URL toDataURL() hands back,
  // and it stays one all the way into pdf-lib's embedPng().
  "img-src 'self' data:",

  // Belt and braces. pdf.js gives embedded fonts to `new FontFace(name, bytes)`
  // — an ArrayBuffer, never a request — so this does nothing in a current
  // browser. It covers the older path, which serialises the same font into a
  // data: URL inside an @font-face rule.
  "font-src data:",

  "connect-src 'none'",

  // Neither is used, and both are injection footholds worth closing: a <base>
  // silently rewrites every relative URL on the page, and a form posts wherever
  // its action says.
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// https://vite.dev/config/
export default defineConfig({
  base: '/inkline/',
  plugins: [react(), tailwindcss(), {
    /**
     * Put the policy in the built HTML.
     *
     * A <meta> tag rather than the Content-Security-Policy response header
     * every guide recommends, because GitHub Pages serves static files and
     * offers nowhere to set one. The cost is the three directives a browser
     * ignores in meta form: `frame-ancestors`, `report-uri` and `sandbox`. So
     * this policy cannot stop another site framing the page, and cannot report
     * a violation — though reporting would have meant a request, and requests
     * are the thing being forbidden.
     *
     * `apply: 'build'` is load-bearing, not tidiness. The dev server needs an
     * inline module preamble for Fast Refresh, a WebSocket for HMR, and the
     * <style> tags Tailwind injects through JS — three violations of a policy
     * the production output satisfies effortlessly, because all of it ships as
     * external files. Without this line, `npm run dev` serves a blank page.
     */
    name: 'inkline-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: CSP,
        },
        // A meta policy governs only the markup that follows it, so it has to
        // come first — ahead of the icon links, ahead of the module script Vite
        // appends.
        injectTo: 'head-prepend'
      }
    ]
  }],
})
