# Wave plan — handoff, auto-pack, AR healing

Fourth milestone. Scope guard: Inkline is for **stencils and dessert design
images** — no client-management features. Three waves, strictly sequential:
implement → PR to main → CI green → verify `baseRefName: main` →
`gh pr merge --squash --delete-branch` → sync → OTA
(`eas update --branch production --environment production`) → next branch from
fresh main. Runtime stays `1.4.0`; all pure JS.

## Status — milestone complete

All three waves merged sequentially and shipped by OTA to runtime 1.4.0
(2026-08-19): Studio handoff (#37), Auto-arrange (#38), AR healed preview
(#39). Suite: 225 tests. Owner gates: AirDrop round-trip with both phones,
packing feel on a printed sheet, healed overlay believability on skin.

## Wave 1 — Studio handoff

**Branch** `agent/studio-handoff`

Two users, two phones, zero shared state. Export any design or saved sheet as
one `.inkline` file → AirDrop → import on the other phone.

- `mobile/src/lib/handoff.ts` (pure encode/decode/validate):
  - Envelope: `{ format: "inkline-handoff", version: 1, brand, kind:
    "design" | "sheet", payload }`. Design payload: title, tags, source,
    width/height, PNG base64. Sheet payload: name, templateId, items (minus
    stale URIs), plus a `designs` map of every referenced design's payload so
    the sheet arrives whole.
  - `encodeDesignHandoff` / `encodeSheetHandoff` → string;
    `decodeHandoff(raw)` → typed result or `{ error }` — never throws on junk
    (bad JSON, wrong format, future version, missing fields all produce a
    named error).
  - `contentFingerprint(base64)` — djb2 over the PNG bytes string; import
    dedupes against fingerprints of existing library entries so re-importing
    the same file doesn't double up.
- Builder wiring: design long-press sheet gains **Hand off** (writes the file
  to cache, `shareUri`); saved-sheet row gains the same. Import lives next to
  Upload: **Import** picks via `File.pickFileAsync`, decodes, dedupes,
  restores designs through `addToLibrary` + `setDesignTags`, sheets through
  `saveSheet` with items re-pointed at the imported design ids.

**Gate** encode/decode round-trip for both kinds, junk tolerance (bad JSON,
wrong magic, future version, truncated payload), tag survival, fingerprint
stability and collision-free-ness on distinct payloads, sheet item re-pointing.

## Wave 2 — Auto-pack sheet layout

**Branch** `agent/sheet-autopack`

- `mobile/src/lib/autopack.ts` (pure): shelf packing, biggest-area-first,
  optional 90° rotation when an item fits rotated but not upright, fixed
  gutter (default 0.2in), bounds = template minus margin. Deterministic:
  ties broken by input order. Returns placements + the items that did not
  fit (never silently dropped).
- Builder: **Auto-arrange** button when ≥2 items are on the sheet — packs the
  *current sheet items* (not the whole library) at their existing sizes; one
  `pushHistory()` so one undo restores the manual layout.

**Gate** no overlaps (pairwise, incl. gutter), all inside bounds, rotation
used only when it helps, overflow reported, determinism, degenerate inputs.

## Wave 3 — Healed preview in live AR

**Branch** `agent/ar-healed-preview`

- `PlacementPreview` live mode gains the fresh / 2yr / 10yr chips
  (`HEAL_AGES`). Selecting an age runs `simulateHealing(designDataUrl, age,
  ppi / 25.4)` — ppi is the calibrated screen density, so the millimetre
  migration stays honest at true size. Results cached per age per design;
  fresh clears to the raw design.
- Design source is a file URI → read base64 once, reuse for both ages.
- SIMULATED badge over the stage while an aged render is showing, same idiom
  as the editor.

**Gate** existing suite green (the aging math is already tested); device pass
for the look.

## Owner-gated

1. AirDrop round-trip verified with both phones in hand.
2. Packing aesthetics (gutter feel, rotation choices) on a printed sheet.
3. AR healed overlay believability on skin.
