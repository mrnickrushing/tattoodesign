# Inkline — Ink Lab & Sugar Haus

One toolkit, two studios. Pick a studio at `/` and everything — theme,
copy, style options — reskins to match:

- **Ink Lab** (`/ink`) — tattoo flash. Dark, crimson, mono display type.
- **Sugar Haus** (`/sugar`) — cookie / cake pop / topper design for
  [The Sugar Haus Bakery]. Warm cream, rose, script wordmark.

Each studio gets the same three tools, themed:

- **Generator** (`/ink/generate`, `/sugar/generate`) — describe a piece and
  generate clean black-line art on white with Gemini, OpenAI GPT Image, or a
  Claude-directed Gemini workflow, then auto-clean it through a client-side
  stencil pipeline.
- **Converter** (`/ink/convert`, `/sugar/convert`) — drop in a photo and
  convert it to clean line art via client-side Sobel edge detection (runs
  entirely in the browser, no server round-trip).
- **Sheet Builder** (`/ink/builder`, `/sugar/builder`) — drag, resize, and
  rotate designs onto classic paper-sized sheet layouts (Letter, Tabloid,
  A4, Square) and print at true size.

Designs made in the Generator or Converter can be sent to that studio's
Sheet Builder via a small localStorage-backed design library. Ink Lab and
Sugar Haus libraries are kept separate — designs never mix between studios.

Studio-specific copy, style-chip options, and image-model prompt language all
live in `src/lib/brands.ts`.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and pick a studio.

## Generator setup

The Generator supports Gemini, OpenAI GPT Image, and Claude-directed Gemini.
Copy `.env.example` to `.env.local` and set the keys for the choices you want:

```
GEMINI_API_KEY=your-key-from-https://aistudio.google.com/apikey
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Without the corresponding key, that choice stays visible but clearly disables
generation rather than faking a result. Claude currently returns text rather
than images, so it refines the art direction before Gemini renders the image.
