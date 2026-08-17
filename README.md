# Inkline — Tattoo Flash Toolkit

Three tools for tattoo artists, built with Next.js:

- **Flash Generator** (`/generate`) — describe a piece and generate clean
  black-line flash art on white, powered by Gemini image generation.
- **Stencil Linework Converter** (`/convert`) — drop in a photo and convert
  it to tattoo-ready line art via client-side Sobel edge detection (runs
  entirely in the browser, no server round-trip).
- **Flash Sheet Builder** (`/builder`) — drag, resize, and rotate designs
  onto classic paper-sized sheet layouts (Letter, Tabloid, A4, Square) and
  print at true size.

Designs made in the Generator or Converter can be sent to the Sheet Builder
via a small localStorage-backed design library.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Flash Generator setup

The Flash Generator calls Google's Gemini image generation API. Copy
`.env.example` to `.env.local` and set:

```
GEMINI_API_KEY=your-key-from-https://aistudio.google.com/apikey
```

Without a key, the Generator page stays visible but clearly disables
generation rather than faking a result.
