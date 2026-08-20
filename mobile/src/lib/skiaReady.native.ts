// Native ships Skia as a real native module, so there is nothing to wait for.
// See skiaReady.ts for what the web build has to do instead.

export function loadSkia(): Promise<void> {
  return Promise.resolve();
}
