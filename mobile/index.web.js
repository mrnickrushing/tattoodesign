// The web build has to load Skia before it loads itself.
//
// @shopify/react-native-skia binds its whole API at module scope on web:
//
//   export const Skia = JsiSkApi(global.CanvasKit);
//
// That line runs the moment anything imports Skia, which — through the import
// graph — is the moment the bundle evaluates. If CanvasKit has not been put on
// the global by then, every factory binds to undefined and the failure shows up
// much later as "Cannot read properties of undefined (reading
// 'MakeImageFromEncoded')" the first time someone traces a photo.
//
// Waiting inside a component is too late for the same reason: by the time any
// component renders, the imports have already run. So the app is required
// rather than imported, which defers evaluating any of it until CanvasKit is
// on the global.

import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// Served from public/ so the app works offline and cannot be broken by
// someone else's CDN. Without an explicit path the loader asks for a file the
// server does not know about and gets index.html back, which surfaces as a
// baffling "expected magic word" WebAssembly error.
LoadSkiaWeb({ locateFile: (file) => `/${file}` })
  .catch((error) => {
    // A workbench that will not open is worse than one whose pixel tools
    // report an error when used, so a failed load still starts the app.
    console.error("[inkline] Skia failed to load; pixel tools will not work", error);
  })
  .finally(() => {
    require("expo-router/entry");
  });
