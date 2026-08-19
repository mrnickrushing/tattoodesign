# Wave plan — symmetry, vectorization, and production intelligence

Working notes for a five-wave milestone on Inkline mobile. Each wave is a
self-contained PR: branch `agent/<name>` off `main`, implement, `npm test` +
`tsc --noEmit` clean, PR, CI green, merge, publish OTA, then start the next.

## Status

All five waves are implemented and green. Each shipped as its own PR, stacked
in order because the merge step needed an approval this session did not have:

| Wave | PR | Branch | State |
|---|---|---|---|
| 1 · Symmetry and radial drawing | #18 | `agent/symmetry-radial-drawing` | CI green, awaiting merge |
| 2 · Centerline vectorization | #19 | `agent/centerline-vectorization` | CI green, awaiting merge |
| 3 · Blowout spacing check | #20 | `agent/blowout-spacing-check` | CI green, awaiting merge |
| 4 · Healed-tattoo simulator | #21 | `agent/healed-simulation` | CI green, awaiting merge |
| 5 · Large-format tiling | #22 | `agent/large-format-tiling` | CI green, awaiting merge |

Merge in order, bottom-up from #18; each PR retargets to `main` as its parent
lands. Publish once after the last merge:

```
eas update --branch production --message "Symmetry, vector tracing, spacing, healing, tiling"
```

Suite went from 8 tests to 88 across the milestone.

## Standing constraints

- **Do not bump `version` in `mobile/app.json` or `mobile/package.json`.**
  `runtimeVersion.policy` is `appVersion`, so the app stays on runtime `1.3.0`
  and every OTA in this milestone reaches TestFlight build 12 with no new
  binary. A version bump would orphan the published updates and force a
  rebuild + resubmit.
- Publish after each merge: `eas update --branch production --message "<wave>"`.
- Pure logic lands in `mobile/src/lib/*.ts` with `tsx --test` coverage.
  Components stay thin. This is the existing shape of the codebase and it is
  what keeps these waves testable without a device.
- Native deps are frozen for the milestone. Everything below runs on what
  `1.3.0` already ships (Skia, gesture-handler, reanimated, svg). Adding a
  native module would break the OTA path above.

## Wave 1 — Symmetry and radial drawing

**Branch** `agent/symmetry-radial-drawing`

New `mobile/src/lib/symmetry.ts`:

```ts
export type SymmetryMode = "off" | "mirror" | "radial";
export type SymmetryAxis = "vertical" | "horizontal" | "both";
export type SymmetrySettings = { mode: SymmetryMode; axis: SymmetryAxis; segments: number };
export const DEFAULT_SYMMETRY: SymmetrySettings;
export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 24;
export function replicateStroke(
  points: Point[],
  settings: SymmetrySettings,
  canvas: { width: number; height: number }
): Point[][];
export function symmetryGuides(
  settings: SymmetrySettings,
  canvas: { width: number; height: number }
): { x1: number; y1: number; x2: number; y2: number }[];
```

- `replicateStroke` always returns the original path first, then the copies.
  `mode: "off"` → `[points]`. Empty input → `[]`.
- Mirror reflects about the canvas centre: vertical → `x' = width - x`,
  horizontal → `y' = height - y`, both → 4 paths.
- Radial rotates about the canvas centre by `k * 2π / segments`, `k = 1..n-1`.
  `segments` clamps to `[MIN_SEGMENTS, MAX_SEGMENTS]`.
- `symmetryGuides` returns axis lines / spokes for the on-canvas overlay.

Wiring in `mobile/src/components/DesignEditor.tsx`:

- `const [symmetry, setSymmetry] = useState(DEFAULT_SYMMETRY)`.
- `finishStroke()` (currently ~line 194) appends one `Stroke` per replicated
  path instead of one, sharing width/color/mode/opacity. Undo already covers
  it — `commit()` snapshots the whole project.
- Live overlay renders every replicated path, not just `currentStroke`, so the
  mirror is visible while drawing. This is the whole feel of the feature.
- Guides drawn on the stage when `mode !== "off"`, reusing the `showGrid` idiom.
- Draw/erase inspector panel gains mode chips, an axis segment control for
  mirror, and a segments slider for radial.

**Gate** unit tests for reflection geometry, rotation geometry, segment
clamping, empty input, and `off` passthrough.

## Wave 2 — Real vectorization (centerline tracing)

**Branch** `agent/centerline-vectorization`

The load-bearing wave. `mobile/src/lib/stencil.ts` already runs grayscale →
blur → Sobel → threshold → dilate in Skia and discards everything but the
bitmap. This wave turns that edge map into geometry.

New `mobile/src/lib/vectorize.ts`:

```ts
export type TraceOptions = { minPathLength: number; simplifyTolerance: number; maxPaths: number };
export const DEFAULT_TRACE: TraceOptions;
export function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array;
export function tracePolylines(skeleton: Uint8Array, width: number, height: number, options: TraceOptions): Point[][];
export function simplify(points: Point[], tolerance: number): Point[];
export function polylinesToStrokeLayer(paths: Point[][], width: number, height: number, strokeWidth: number): StrokeLayer;
```

Pipeline: binary mask → Zhang-Suen thinning to 1px skeleton → walk each
8-connected run from its endpoints into polylines (junctions split paths) →
Ramer-Douglas-Peucker simplify → emit into the existing `StrokeLayer` model so
the Wave 1 editor can immediately touch up the result node by node.

Also fixes `projectToSvg` in `mobile/src/lib/projectMutations.ts:97`, which
today filters raster layers out entirely — a converted photo currently exports
as an empty SVG. Raster layers embed as a base64 `<image>` with the layer
transform applied, so vector export is complete regardless of layer mix.

**Gate** thinning idempotence on a known mask, polyline extraction on a
synthetic cross and ring, RDP simplification bounds, an SVG export containing
both a raster `<image>` and vector `<path>`. Watch memory at
`maxDimension: 1200` — thinning is iterative and allocates per pass.

## Wave 3 — Blowout / minimum line-spacing checker

**Branch** `agent/blowout-spacing-check`

Rides on Wave 2: spacing analysis is far cheaper on paths than pixels.

Extends `inspectProduction()` in `mobile/src/lib/productionTools.ts` with a
true-size spacing pass. Physical dimensions come from `mobile/src/lib/measure.ts`;
the threshold is the gap a liner can hold without the ink closing up — default
0.8 mm, exposed as a constant so it can be tuned per brand (Sugar Haus icing
tips are far coarser than a tattoo liner).

```ts
export const MIN_LINE_GAP_MM = { ink: 0.8, sugar: 2.0 };
export function checkLineSpacing(paths: Point[][], pxPerMm: number, minGapMm: number): ProductionFinding[];
```

Reports the count and worst-case gap, returning existing `ProductionFinding`
shapes so the Production desk renders them with no UI change. Uses a uniform
spatial grid keyed on the gap distance — pairwise segment comparison is
O(n²) and will stall on a dense trace.

**Gate** two parallel lines just inside and just outside the threshold, a
self-intersecting path (must not report a stroke against itself), and unit
conversion against a known DPI.

## Wave 4 — Healed-tattoo simulator

**Branch** `agent/healed-simulation`

Ink spread over years is a dilate plus a blur, both of which `stencil.ts`
already implements in Skia. New `mobile/src/lib/healing.ts`:

```ts
export type HealAge = "fresh" | "twoYear" | "tenYear";
export function healingProfile(age: HealAge, pxPerMm: number): { spreadPx: number; blurPx: number; contrast: number };
export async function simulateHealing(dataUrl: string, age: HealAge, pxPerMm: number): Promise<string>;
```

Spread is defined in **millimetres, then converted to pixels**, so the
simulation is honest across DPI instead of drifting with image resolution.
Renders at true print size next to the fresh version. Pairs with Wave 3: one
predicts the failure, the other measures it.

**Gate** profile scaling is linear in `pxPerMm`, ordering holds
(`fresh < twoYear < tenYear`), output dimensions are preserved.

## Wave 5 — Large-format tiling

**Branch** `agent/large-format-tiling`

Thermal printers in `mobile/src/lib/printerProfiles.ts` cap out near 4 inches,
which caps the whole app at small work. Tiling lifts that.

New `mobile/src/lib/tiling.ts`:

```ts
export type TileSpec = { cols: number; rows: number; overlapIn: number; sheetWIn: number; sheetHIn: number };
export function planTiles(designWIn: number, designHIn: number, spec: Omit<TileSpec, "cols" | "rows">): TileSpec;
export function tileRects(spec: TileSpec): { col: number; row: number; xIn: number; yIn: number; wIn: number; hIn: number }[];
export function registrationMarks(spec: TileSpec, index: number): { x: number; y: number; kind: "corner" | "edge" }[];
```

Overlap defaults to 0.25 in. Each sheet carries registration marks and a
`row/col` label; the assembly guide is a contact sheet of the grid. Builds on
the calibration already in `printerProfiles.ts` so tiles land dimensionally
correct rather than nominally correct.

**Gate** tile count covers the full design at various overlaps, overlap never
exceeds sheet width, a 1×1 plan degenerates cleanly to the current behaviour,
and total covered area ≥ design area.

## Owner-gated blockers

These need a decision or a device and sit outside the PR stream. Implementation
does not wait on them.

1. **Healed-simulation calibration** (Wave 4) — the spread-per-year numbers are
   a defensible starting estimate, not measured data. Real healed-tattoo
   photos would let us fit them properly. Ships behind honest "estimate"
   framing until then.
2. **Spacing thresholds** (Wave 3) — 0.8 mm liner / 2.0 mm icing are starting
   points and want confirmation from real production runs.
3. **Physical tiling validation** (Wave 5) — registration alignment can only
   be confirmed by printing and assembling on the actual BLE hardware.
