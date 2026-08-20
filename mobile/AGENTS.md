# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# The web app is this app

There is no separate web front end. `mobile/` targets web as well, and the
browser build is the same code — the old Next.js UI under `src/app/[brand]/`
was a tenth of it and kept drifting.

- **Live at https://inkline.expo.app** — `npx eas-cli deploy --prod` from
  `mobile/` publishes it. The Next.js app on Railway now only serves
  `/api/generate`.
- Platform differences live in `.web.ts` siblings, never in branches inside a
  screen: `designFiles`, `projectStore`, `imageSource`, `files`, `printing`,
  `skiaReady`, `blePrinter`.
- Skia is WebAssembly in a browser and binds its whole API at import time, so
  `index.web.js` loads CanvasKit before requiring the app. Anything that
  imports Skia before that binds to undefined.
