// Skia, on a laptop.
//
// Everything that makes a design — tracing, tone separation, shading, the
// surface warp, the sheet compositor — runs through react-native-skia. On a
// phone that is a native module and is simply there. In a browser it is
// CanvasKit compiled to WebAssembly, and it has to be fetched and initialised
// before the first Skia call, or every one of those tools fails with an error
// about a missing native module.
//
// So the web build waits for it. A blank moment on first load is a far better
// trade than a UI that renders instantly and then breaks the moment you press
// anything, which is what the untreated version does.
//
// Native resolves this to skiaReady.native.ts, which has nothing to wait for.

import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

let pending: Promise<void> | null = null;

/**
 * Resolves once Skia can be called. Safe to await repeatedly — the load is
 * started once and every caller waits on the same promise.
 */
export function loadSkia(): Promise<void> {
  // index.web.js loads it before any of the app evaluates, which is the only
  // ordering that works — Skia binds its API at import time. This is a safety
  // net for anything that boots another way.
  if (typeof global !== "undefined" && (global as { CanvasKit?: unknown }).CanvasKit) {
    return Promise.resolve();
  }
  if (!pending) {
    // The wasm is served from public/ rather than fetched from a CDN, so the
    // app keeps working offline and cannot be broken by someone else's
    // hosting. Without an explicit path the loader asks the dev server for a
    // file it does not know about and gets index.html back, which fails as a
    // confusing "expected magic word" WebAssembly error.
    pending = LoadSkiaWeb({ locateFile: (file) => `/${file}` }).catch((error) => {
      // Let the next caller try again rather than caching a failure for the
      // life of the tab; a wasm fetch can fail for reasons that pass.
      pending = null;
      throw error;
    });
  }
  return pending;
}
