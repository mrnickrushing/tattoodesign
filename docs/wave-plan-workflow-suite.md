# Wave plan — library organization, lettering, cleanup, clients, AR

Second wave milestone. Five waves, **strictly sequential**: implement → PR →
CI green → **merge to main** → OTA publish → only then branch the next wave.
No stacked PRs — the last stack's merges landed in parent branches instead of
main and needed a recovery PR (#23).

## Status — milestone complete

All five waves merged sequentially and shipped (2026-08-19):

| Wave | PR | Delivery |
|---|---|---|
| A · Library search, tags, favorites | #27 | OTA to 1.3.0 (build 12) |
| B · Lettering studio | #28 | OTA to 1.3.0 (build 12) |
| C · Smart cleanup | #29 | OTA to 1.3.0 (build 12) |
| D · Client projects extended | #30 | OTA to 1.3.0 (build 12) |
| E · Live AR placement | #31 | **1.4.0, build 13** + OTA baseline on the new runtime |

Suite: 156 tests. Owner gates still open: device pass on the live camera
preview scale, lettering font taste check on the phone.

## Standing constraints

- Waves A–D: **no version bump** — runtime stays `1.3.0`, each merge ships by
  `eas update --branch production --environment production` to build 12.
- Wave E adds `expo-camera` (native) → bumps to `1.4.0` and cuts build 13 via
  `eas build --platform ios --profile production --auto-submit`.
- Pure logic in `mobile/src/lib/*.ts` with `tsx --test` coverage; components thin.
- Merge with `gh pr merge --squash --delete-branch`. If the permission
  classifier blocks it, stop and ask the owner to merge — do not stack.

## Wave A — Library search, tags, favorites

**Branch** `agent/library-organization`

- `LibraryDesign` gains `tags?: string[]`, `favorite?: boolean` (both optional →
  no migration; absent means untagged/unfavorited).
- `designLibrary.ts` mutations: `setDesignTags(brand, id, tags)`,
  `setDesignFavorite(brand, id, favorite)`.
- New pure `mobile/src/lib/libraryFilter.ts`:
  `normalizeTags(input: string): string[]` (comma-split, trim, lowercase, dedupe),
  `allTags(designs): string[]` (frequency-sorted),
  `filterDesigns(designs, {query, source, favoritesOnly, tag})` — query matches
  title and tags case-insensitively; favorites sort first within results.
- Builder "Your designs" section: search field, source chips
  (All / Generated / Converted / Uploaded / ★), tag chip row when tags exist.
- `DesignActions` sheet gains Favorite toggle and "Tags…" (comma-separated
  prompt, reusing the existing NamePrompt flow).

**Gate** unit tests for normalizeTags, allTags ordering, query/source/tag/
favorites filtering, and favorites-first ordering.

## Wave B — Lettering studio

**Branch** `agent/lettering-studio`

Script is half of walk-in work. Render text → **editable vector strokes** by
reusing the existing pipeline end to end: Skia paragraph render at high res →
`stencilMask` → `skeletonize` → `tracePolylines` → `StrokeLayer`.

- New `mobile/src/lib/lettering.ts`: `LETTERING_STYLES` (Caveat script,
  Playfair serif, Bebas display — fonts already shipped), `renderLettering(text,
  style, {curve, size})` → data URL via Skia; curve bends the baseline by
  drawing per-glyph along an arc (positive = arch, negative = valley).
- Pure helpers separated for tests: `arcLayout(widths, curve, radius)` returns
  per-glyph x/y/rotation — testable without Skia.
- Entry point: an "Add lettering" action in the editor Insert panel → modal
  with text field, style chips, curve + size sliders, live preview → traces to
  a new stroke layer.
- Auto-run `checkLineSpacing` on the traced output and surface the finding —
  script is exactly where letters bleed at small sizes.

**Gate** arc layout tests (flat curve = straight line, symmetry, rotation
signs), style table integrity; trace integration verified by existing tracer
suite.

## Wave C — Smart cleanup assistant

**Branch** `agent/smart-cleanup`

One button wiring shipped primitives, every fix an undoable layer edit:

- New `mobile/src/lib/cleanup.ts`:
  `findSpecks(paths, minLengthPx)` (tracer already filters; this reports them),
  `bridgeGaps(paths, maxGapPx)` — join path endpoints closer than the gap,
  `cleanupReport(paths, pxPerMm)` — specks, bridgeable gaps, dense regions via
  `checkLineSpacing`.
- Editor: "Clean up" action in the Lines panel; runs on the traced vector
  layer; applies speck removal + gap bridging as one `commit()` (one undo).

**Gate** bridge tests (joins under threshold, refuses over, respects path
direction), speck reporting, report shape.

## Wave D — Client & order projects, extended

**Branch** `agent/client-projects-extended`

`clientProjects.ts` already holds name/client/placement/notes/designIds/status.
Extend, don't rebuild:

- Add `appointmentAt?: number`, `sizeIn?: { width: number; height: number }`,
  `referenceUris?: string[]` to `ClientProject` (all optional → no migration).
- Projects screen: date field (text `YYYY-MM-DD` parsed leniently — no native
  date picker without a new module), size fields, reference image picker
  (expo-image-picker already shipped), upcoming-appointment sort + badge.
- Wave A integration: saving a project offers to tag its linked designs with
  the client name.

**Gate** date parsing tests (valid, garbage, empty), size validation,
appointment ordering.

## Wave E — Live AR placement (NATIVE, last)

**Branch** `agent/ar-placement`

- Add `expo-camera` + plugin with camera permission copy.
- `PlacementPreview` gains a Live mode: camera behind the design at true size
  (via `measure.ts` PPI), opacity slider, freeze-frame toggle to compare.
- **Bump `1.3.0` → `1.4.0`** in app.json + package.json (this orphans the
  1.3.0 OTA chain deliberately — the new native module requires it).
- After merge: `eas build --platform ios --profile production --auto-submit`
  → build 13, then `eas update` on the new runtime for parity.

**Gate** existing suite green; camera behavior is device-verified (owner).

## Owner-gated

1. Wave E device pass — camera preview scale/alignment needs a physical phone.
2. Lettering style tuning — which fonts read as tattoo-script is taste;
   shipped set is Caveat/Playfair/Bebas because they're already bundled.
