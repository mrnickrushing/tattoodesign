# Wave plan — visual language and studio intelligence

Working notes for the milestone that follows the vector-production waves. Same
shape as `wave-plan-vector-production.md`: each wave is a self-contained PR,
branched `agent/<name>` **off `main`** (not off the previous wave — the stacked
bases in #19–#22 merged into each other instead of into `main` and had to be
recovered by hand in #23), implemented, `npm run lint` + `tsc --noEmit` +
`npm test` clean, PR, CI green, merge, publish OTA, next.

Wave 1 is implemented in this PR. Waves 2–6 are OTA-safe and can follow on the
same binary. Waves 7–11 require a new native runtime and are gated at the bottom.

## Status — waves 1–6 complete

Wave 1 shipped with the doc. Waves 2–6 shipped together rather than one PR each:
the harness this session ran under develops on a single named branch, so the
sequential-PR ritual at the top could not be followed and the waves are five
commits on one branch instead. Every other standing constraint held — no version
bump, no new native dependency, pure logic in `mobile/src/lib/*.ts` under
`tsx --test`, thin components. 601 tests, up from 491.

Where the implementation departs from the sketches above, and why:

- **Wave 2** splits across `sketch.ts` (pure) and `sketchDeskew.ts` (Skia), the
  same way `vectorize.ts` splits from `stencil.ts`, so every decision stays
  testable off-device. `deskew` takes the forward homography — the direction
  `canvas.concat` wants — rather than the inverse-sampling one. `sheetMask` and
  `otsuThreshold` were added because `estimatePaperQuad` needs a mask and
  nothing produced one. `consolidateStrokes` gained a pixel-space sibling,
  `consolidateWithin`: a mask has no physical size yet, and the tracer's real
  unit is the line weight it just traced at.
- **Wave 3** returns a `DensityMap` — cells plus the grid and frame — rather
  than a bare `Float32Array`, following `StencilMask`. Coverage compares
  fractions of skin and caps at solid: skin holds only so much pigment, and
  asking for twice the ink of an already-solid old piece would call every
  cover-up of heavy blackwork impossible.
- **Wave 4** keeps `estimateHours`/`quote`/`icingPlan` and adds `planBatch` for
  the batch-order mode the prose describes. `BatchDesign` carries piece size,
  because cups of icing cannot be derived from a count alone.
- **Wave 5** could not connect to the separate `TattooAftercare` project — it is
  not reachable from this repo — so the schedule is written in `aftercare.ts`.
  Swapping the source later does not touch the card.
- **Wave 6** feeds `Point.w` and lets `ribbon.ts` render it, so there is no new
  Skia in the wave at all.

**Wave 7 (AR live body placement) also already shipped**, ahead of this doc's
own gating — `PlacementPreview.tsx` has used `CameraView` since the AR healed
preview landed (#39) and the runtime is at 1.4.0. Waves 8, 10 and 11 remain
unbuilt.

## Standing constraints

- **Do not bump `version` in `mobile/app.json` or `mobile/package.json`.**
  `runtimeVersion.policy` is `appVersion`, so the app stays on runtime `1.3.0`
  and every OTA in waves 1–6 reaches TestFlight build 12 with no new binary.
- **No new native dependencies in waves 1–6.** Everything in this milestone
  runs on what `1.3.0` already ships. Three of those shipped libraries are
  currently installed with zero imports anywhere in `mobile/src` —
  `expo-glass-effect`, `expo-symbols`, and `@expo/ui` — so the entire visual
  wave is paid for and unused. Wave 1 spends it.
- Pure logic lands in `mobile/src/lib/*.ts` with `tsx --test` coverage.
  Components stay thin. Anything that can be expressed as geometry, timing, or
  a mapping table belongs in `lib/` and gets tested without a device.
- Every visual capability degrades. Liquid glass and SF Symbols are iOS-version
  gated, so each is wrapped in a component with a defined fallback rather than
  called at the point of use. Nothing regresses on an older OS.
- Publish after each merge: `eas update --branch production --message "<wave>"`.

## Where the visuals actually stand

The design system is sound — brand-scoped themes, a shared `SPACE`/`RADIUS`
scale, `glow()` for near-black surfaces against `lift()` for cream, real font
pairing, haptics on every control. The gap is not taste, it is that the app is
drawn almost entirely with `View` and `LinearGradient`:

1. **Skia never renders on screen.** It is imported in 11 files under
   `src/lib/` — `stencil.ts`, `icing.ts`, `touchup.ts`, `projectRenderer.ts`,
   `productionTools.ts` and others — every one of them offscreen image
   processing. There is not a single `<Canvas>` in any component. The whole
   Skia bundle ships as a batch processor.
2. **`expo-glass-effect`, `expo-symbols`, `@expo/ui` have zero imports.** The
   tab bar and studio header are opaque `theme.surface`.
3. **Reanimated exists only inside gesture handlers** — `PlacementPreview`,
   `DesignEditor`, `CropTool`, `ImageViewer`, `builder.tsx`. No `entering` /
   `exiting`, no layout transitions, no staggered lists. Screens hard-cut.
4. **The signature surface is used inconsistently.** The `stock` / `stockMark` /
   `stockGrid` / `stockInk` tokens model real warm flash paper with
   registration marks and a printed dot grid, and `StockPane.tsx` renders them
   properly. But the dashboard (`app/[brand]/index.tsx`), project artwork
   (`projects.tsx`), and the variation cards in `generate.tsx` use
   `theme.stock` as a flat fill with no marks and no grain. The best idea in
   the codebase appears in one component.
5. **The peak moment has no payoff.** Generation — the one screen where the
   user is emotionally invested, waiting to see their idea — is an
   `ActivityIndicator` with a "Generating" label.
6. **No appearance response.** `useColorScheme` is called nowhere. Sugar Haus
   is light-only, which is the wrong brightness in a kitchen at 5am.

## Wave 1 — Visual language (this PR)

**Branch** `agent/visual-language-overhaul`

### `mobile/src/lib/paper.ts`

Deterministic paper-grain field, so the substrate is reproducible and testable
rather than random per render.

```ts
export type PaperKind = "flash" | "parchment";
export type GrainField = { width: number; height: number; values: Float32Array };
export const GRAIN_RESOLUTION: number;
export function grainField(kind: PaperKind, seed: number, size?: number): GrainField;
export function grainAt(field: GrainField, x: number, y: number): number;
export function vignetteAlpha(x: number, y: number, w: number, h: number, strength: number): number;
```

Value-noise summed over three octaves, normalised to `[0, 1]`. `flash` is
coarser and warmer-biased (tattoo stock has visible tooth); `parchment` is
finer and more even. A given `seed` always produces the same field, so a
design's paper does not shimmer between renders or re-mount.

### `mobile/src/lib/reveal.ts`

Timing for the stencil reveal. Ordering and per-path timing is arithmetic, not
animation, so it is unit-tested away from the device.

```ts
export type RevealTiming = { index: number; delayMs: number; durationMs: number; length: number };
export const DEFAULT_REVEAL = { totalMs: 1200, minPathMs: 90, staggerRatio: 0.35 };
export function pathLength(points: Point[]): number;
export function orderForReveal(paths: Point[][]): number[];
export function revealTimings(paths: Point[][], totalMs?: number): RevealTiming[];
```

`orderForReveal` sorts longest-first so the main silhouette lands before detail,
which is how a stencil is actually drawn. `revealTimings` distributes
`totalMs` proportional to path length with a stagger, clamped so no path is
shorter than `minPathMs` and the last path always finishes exactly at
`totalMs`. Consumes the `Point[][]` that `vectorize.ts:tracePolylines` already
returns, so generation and conversion both feed it with no new plumbing.

### `mobile/src/lib/icons.ts`

Semantic icon names mapped to both an SF Symbol and an Ionicons fallback, in
one table rather than at 40 call sites.

```ts
export type IconName = "generate" | "convert" | "sheet" | "home" | "settings" | ...;
export const ICONS: Record<IconName, { sf: string; ion: keyof typeof Ionicons.glyphMap }>;
export function iconFor(name: IconName): { sf: string; ion: string };
```

Gate: every `IconName` resolves to a non-empty pair, and the table has no
duplicate SF Symbol assigned to semantically different actions.

### Theme extensions — `mobile/src/lib/theme.ts`

- `TYPE` scale: `{ hero: 76, display: 48, title: 34, heading: 22, body: 15, caption: 12, micro: 9 }`
  with paired `lineHeight` and `letterSpacing`. Bebas Neue currently caps at
  48px in the studio picker and 34px in `ScreenHeader`; it is a condensed
  display face and wants to be enormous.
- `THEMES.sugarDark` — warm cocoa and rose rather than inverted cream, plus
  `resolveTheme(brandId, scheme)` so `useColorScheme` drives it. Ink Lab is
  already dark and resolves to itself under both schemes.
- Both new tokens are additive. No existing token changes value, so nothing
  already shipped shifts colour.

### Components

- **`PaperSubstrate.tsx`** — Skia `<Canvas>` rendering `paper.ts` grain plus a
  vignette, the first on-screen Skia in the app. Sits beneath the stock
  surfaces. Ink Lab reads as tooth and warmth, Sugar Haus as parchment.
- **`StencilReveal.tsx`** — `react-native-svg` paths animating
  `strokeDasharray`/`strokeDashoffset` on `reveal.ts` timings, so a generated
  design draws itself on rather than popping in. Replaces the spinner as the
  generation and conversion result state.
- **`Icon.tsx`** — `expo-symbols` `SymbolView` when available, Ionicons
  otherwise, driven by `icons.ts`.
- **`GlassSurface.tsx`** — `expo-glass-effect` `GlassView` behind an
  `isLiquidGlassAvailable()` check, falling back to the current opaque
  `theme.surface`. Applied to the tab bar, the studio header, and the
  `DesignEditor` inspector, with content scrolling underneath.
- **`Skeleton.tsx`** — shimmer placeholders on the stock texture, replacing
  spinners on the dashboard's recent-designs row and saved-sheets list.
- **`EmptyStock.tsx`** — empty states drawn on real stock with crop marks and
  a ghost design, replacing the current icon-plus-two-lines rows.
- **`BrandArtwork.tsx`** — the existing hand-authored SVG gains an animated
  draw-on (the Ink Lab dagger inks itself in; the Sugar Haus piping line
  loops), plus parallax on the studio-picker ambient orbs.
- **`IcingPreview.tsx`** — Skia specular highlight and bevel, so royal icing
  reads wet instead of flat. For a bakery this is the product.
- **`ImageViewer.tsx`** — opens from the measured frame of the thumbnail that
  launched it and returns to it, so the library flows instead of hard-cutting.
  Reanimated 4 dropped `sharedTransitionTag`, so this is a measured-origin
  zoom rather than a shared-element transition.

### Screens

`ScreenHeader` and the studio picker adopt `TYPE`. The dashboard, project
artwork, and generator variation cards move onto `StockPane`/`PaperSubstrate`
so the signature paper is the app's substrate rather than one component's
detail. Lists gain `FadeInDown` stagger and `LinearTransition`.

**Gate** unit tests for grain determinism under a fixed seed, grain range
`[0,1]`, octave count, vignette monotonicity from centre to corner; reveal
ordering longest-first, total duration exactly `totalMs`, `minPathMs` clamp,
empty input, single path; icon table completeness; `resolveTheme` returning
`sugarDark` only for `sugar` + `dark`. Plus `expo export --platform ios` clean,
which is what actually catches a bad native import.

## Wave 2 — Sketch-to-stencil

**Branch** `agent/sketch-to-stencil`

Point the existing pipeline at a bad drawing instead of a good photo. Napkin
sketch or in-app rough → `stencil.ts` → `vectorize.ts` → `StrokeLayer`, then
straight into the Wave 1 editor for node-level cleanup. The work is
pre-processing: perspective correction from photographed paper, paper-shadow
and ruled-line removal, and a stroke-consolidation pass so a sketchy
triple-drawn contour becomes one path instead of three.

```ts
export function estimatePaperQuad(mask: Uint8Array, w: number, h: number): Quad | null;
export function deskew(dataUrl: string, quad: Quad): Promise<string>;
export function consolidateStrokes(paths: Point[][], toleranceMm: number, pxPerMm: number): Point[][];
```

**Gate** quad detection on a synthetic rotated rectangle, deskew idempotence
on an already-square input, consolidation collapsing three near-parallel
paths to one while preserving a genuine double line.

## Wave 3 — Skin tone and cover-up mapping

**Branch** `agent/skin-and-coverup`

Two related honesty features. Black linework reads completely differently on
deep skin, and the app currently previews everything on white stock.

- `skinTones.ts` — a Fitzpatrick-derived tone set, with `PlacementPreview`
  rendering against the selected tone instead of `theme.stock`, and a contrast
  warning when line weight will not hold.
- `coverup.ts` — photograph an existing tattoo, measure its ink density and
  edge strength, and report the coverage the new design must reach. Reuses the
  density work already in `spacing.ts` and flags regions where the candidate
  design is too open to cover.

```ts
export const SKIN_TONES: { id: string; label: string; hex: string; l: number }[];
export function lineContrast(inkHex: string, skinHex: string): number;
export function inkDensityMap(mask: Uint8Array, w: number, h: number, cell: number): Float32Array;
export function coverageGaps(design: Float32Array, existing: Float32Array, threshold: number): Region[];
```

Nothing on the market does cover-up assessment well and it is the highest-value
unsolved problem in the trade.

**Gate** contrast ratio against known pairs, density map sums to the mask's
ink count, coverage gaps empty when the design strictly dominates.

## Wave 4 — Quoting and batch orders

**Branch** `agent/quoting-and-batch`

Both studios systematically undercharge, and both have the numbers already.

- Ink Lab: quote from true size, placement difficulty, detail density
  (`spacing.ts` computes it), and estimated session hours.
- Sugar Haus: quote from quantity, colour count, cutter size, and sheet count
  (`tiling.ts` computes it), plus an icing shopping list with quantities.
- Batch order mode: 200 cookies, 6 designs, 4 colours → cut files, tiled
  sheets, and a production run sheet in one pass.

```ts
export type QuoteInput = { widthIn: number; heightIn: number; density: number; placement: PlacementId; hourlyRate: number };
export function estimateHours(input: QuoteInput): number;
export function quote(input: QuoteInput): { hours: number; subtotal: number; lines: QuoteLine[] };
export function icingPlan(designs: BatchDesign[], quantity: number): IcingLine[];
```

**Gate** monotonicity (more area and more density never quote lower), placement
multipliers applied once, icing quantities scaling linearly with count.

## Wave 5 — Aftercare handoff

**Branch** `agent/aftercare-handoff`

Generate a personalised aftercare card from the finished piece — placement,
true size, ink coverage, session date — and share it to the client through
`expo-sharing`, which is already a dependency. Connects to the existing
`TattooAftercare` project rather than reimplementing its content. Sugar Haus
gets the equivalent: storage, shelf life, and serving notes per order.

**Gate** card renders at a fixed size for every placement value, no unresolved
template tokens in output, share payload present without network access.

## Wave 6 — Ink and icing material simulation

**Branch** `agent/material-simulation`

Extends `healing.ts` from "how it ages" to "how it lays down". Line weight
varying with needle grouping and hand speed for Ink Lab; icing bead width per
tip size for Sugar Haus. The design previews as it will physically exist
rather than as flat vector. Pure Skia and geometry, so it stays OTA-safe.

```ts
export const NEEDLE_GROUPINGS: { id: string; label: string; widthMm: number }[];
export const ICING_TIPS: { id: string; label: string; beadMm: number }[];
export function strokeProfile(points: Point[], groupingMm: number, pxPerMm: number): number[];
```

**Gate** profile length matches input point count, width scales linearly with
grouping, tip bead widths convert correctly across DPI.

## Native-runtime waves — require a new binary

Everything below needs a native module or a backend, which breaks the OTA path
above. Each is a version bump, an EAS build, and a TestFlight resubmit, so they
should be batched into one runtime release (`1.4.0`) rather than taken one at a
time.

7. **AR live body placement** — `expo-camera`. `PlacementPreview.tsx` already
   does true-size photo mockups with real measurement math from `measure.ts`;
   this is that, live, with a freeze-frame to hand the phone to the client.
   The highest-impact feature in the entire plan and the one that sells the app
   to a working artist. Needs calibration against a known reference.
8. **Voice-to-design** — speech recognition. Both studios share the same
   constraint: you cannot touch a phone with ink or flour on your hands.
9. **Live client co-design and approval links** — a realtime backend plus
   accounts. Two devices on one design, or a link the client opens and
   annotates by tapping the spot they want changed. Extends backlog item 7
   from a static proof to a live session.
10. **Style-lock from portfolio** — training or embedding infrastructure and a
    provider that supports reference conditioning. Feed in ten past pieces and
    generation matches that artist's actual hand. The strongest retention
    mechanic here: once a style is trained, leaving is expensive.
11. **Time-lapse export** — `react-native-view-shot` can capture frames, but
    encoding video needs a native encoder. Records every editor stroke and
    exports a vertical reel of the design coming together. Free marketing, and
    the export credits Inkline.

## Owner-gated blockers

Carried forward from the previous milestone, plus this one's. Implementation
does not wait on them.

1. **Healed-simulation calibration** (previous Wave 4) — spread-per-year
   numbers are a defensible estimate, not measured data. Ships behind honest
   "estimate" framing until real healed-tattoo photos let us fit them.
2. **Spacing thresholds** (previous Wave 3) — 0.8 mm liner and 2.0 mm icing
   want confirmation from real production runs.
3. **Physical tiling validation** (previous Wave 5) — registration alignment
   can only be confirmed by printing and assembling on the BLE hardware.
4. **Liquid glass and SF Symbols on device** (Wave 1) — both are iOS-version
   gated and cannot be verified in CI or on a simulator running an older OS.
   Both are wrapped with fallbacks, so the risk is cosmetic, not functional.
5. **Quoting rates** (Wave 4) — hourly rates, placement multipliers, and icing
   yields are placeholders until you supply real numbers from the shop and the
   bakery.
6. **Runtime 1.4.0 scope** (Waves 7–11) — needs a decision on which native
   features are worth one build-and-resubmit cycle, and whether accounts are
   in scope. Waves 9 and 10 also need a privacy and licensing position before
   any client photo or portfolio leaves the device.
