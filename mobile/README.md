# Inkline — iOS app

The mobile client for [Inkline](../README.md): Ink Lab (tattoo flash) and
Sugar Haus (cookie / cake pop / topper design), same three tools as the web
app, built native with Expo + React Native.

- **Generate** — describe a design, calls the same `/api/generate` Gemini
  endpoint the web app exposes (deployed on Railway), then cleans the result
  through an on-device stencil pipeline.
- **Convert** — pick a photo from your library and run it through Sobel
  edge detection entirely on-device via `react-native-skia` — no network
  call, same algorithm as the web app's canvas pipeline.
- **Sheet** — place designs on a Letter/Tabloid/A4/Square sheet; drag, pinch
  to resize, twist to rotate. Export via the native print dialog
  (`expo-print`) or save the composed sheet straight to Photos.

Brand copy, style-chip options, and Gemini prompt language live in
`src/lib/brands.ts` — kept in sync by hand with the web app's
`../src/lib/brands.ts` (a shared package would be the next step if these
drift).

## Getting started

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go, or press `i` for the iOS simulator (requires
a Mac with Xcode).

By default the Generate screen talks to the Railway-hosted deployment of
the web app. To point it at a local `next dev` instance instead, copy
`.env.example` to `.env.local` and set `EXPO_PUBLIC_API_BASE_URL` to your
machine's LAN address (not `localhost` — the simulator/device needs a
reachable host), e.g. `http://192.168.1.23:3000`.

## Building for iOS

This project isn't set up with EAS yet. Once you have an Expo account and
Apple Developer account connected:

```bash
npx eas build --platform ios --profile preview
```
