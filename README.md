# Inkline — Ink Lab & Sugar Haus

One toolkit, two studios. Pick a studio at `/` and everything — theme,
copy, style options — reskins to match:

- **Ink Lab** (`/ink`) — tattoo flash. Dark, crimson, mono display type.
- **Sugar Haus** (`/sugar`) — cookie / cake pop / topper design for
  [The Sugar Haus Bakery]. Warm cream, rose, script wordmark.

Each studio gets the same three tools, themed:

- **Generator** (`/ink/generate`, `/sugar/generate`) — describe a piece and
  generate clean black-line art on white, powered by Gemini image
  generation, then auto-cleaned through a client-side stencil pipeline.
- **Converter** (`/ink/convert`, `/sugar/convert`) — drop in a photo and
  convert it to clean line art via client-side Sobel edge detection (runs
  entirely in the browser, no server round-trip).
- **Sheet Builder** (`/ink/builder`, `/sugar/builder`) — drag, resize, and
  rotate designs onto classic paper-sized sheet layouts (Letter, Tabloid,
  A4, Square) and print at true size.

Designs made in the Generator or Converter can be sent to that studio's
Sheet Builder via a small localStorage-backed design library. Ink Lab and
Sugar Haus libraries are kept separate — designs never mix between studios.

Studio-specific copy, style-chip options, and Gemini prompt language all
live in `src/lib/brands.ts`.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and pick a studio.

## Generator setup

The Generator calls Google's Gemini image generation API. Copy
`.env.example` to `.env.local` and set:

```
GEMINI_API_KEY=your-key-from-https://aistudio.google.com/apikey
```

Without a key, the Generator page stays visible but clearly disables
generation rather than faking a result.
