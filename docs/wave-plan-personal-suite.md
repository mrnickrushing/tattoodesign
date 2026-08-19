# Wave plan — remix, proofs, presets, batch, nodes

Third milestone. Private app for two users (Nick + Allison), TestFlight only —
no store work, ever. Five waves, strictly sequential: implement → PR → CI
green → `gh pr merge --squash --delete-branch` → OTA
(`eas update --branch production --environment production`) → next branch.

## Status — milestone complete

All five waves merged sequentially and shipped by OTA to runtime 1.4.0
(2026-08-19): Remix (#32), Approval proof PDF (#33), Brand presets (#34),
Batch conversion (#35), Node editor (#36). Suite: 206 tests. Owner gates:
proof PDF judged on a real print, node handle feel judged on glass, remix
verb wording is a starting set.

## Standing constraints

- Runtime is `1.4.0` (build 13). **No version bumps** — all five waves are
  pure JS and ship over the air.
- Pure logic in `mobile/src/lib/*.ts` with `tsx --test` coverage.

## Wave 1 — Remix from library

**Branch** `agent/library-remix`

Generate already supports reference images with loose/balanced/faithful
strength; the missing piece is the one-tap path from an existing design.

- Builder `designActions()` gains **Remix** → `router.push` to
  `/${brand.id}/generate?remix=<designId>`.
- `generate.tsx` reads `remix` via `useLocalSearchParams`; on change, loads
  the design from the library, reads its PNG base64 from disk, and seeds the
  `reference` state (strength defaults to `balanced`).
- New pure `mobile/src/lib/remix.ts`: `REMIX_VERBS` (simpler, bolder lines,
  another pose, more symmetrical, …) each mapping to appended prompt language;
  `applyRemixVerb(prompt, verb)` idempotent per verb. Verb chips render under
  the reference card whenever a reference is set.

**Gate** verb application tests (append, idempotence, composing multiple
verbs, empty prompt).

## Wave 2 — Client approval proof PDF

**Branch** `agent/approval-proof-pdf`

- New pure `mobile/src/lib/proofSheet.ts`: `proofHtml(project, designs,
  brandName, assets)` → print HTML. Designs render at **true printed size**
  (CSS inches from `sizeIn`, falling back to 3in wide), with title,
  dimensions, placement, appointment (via appointments.ts formatting), status,
  notes, and a sign-off line. Escapes all user text.
- Projects screen: **Send proof** button per project → render designs' base64,
  `Print.printToFileAsync({ html })` → `shareUri`; offers to advance status
  draft → sent after sharing.

**Gate** HTML tests: escaping, true-size CSS, empty-design handling, status
and appointment rendering.

## Wave 3 — Brand presets

**Branch** `agent/brand-presets`

- New `mobile/src/lib/preferences.ts`: one AsyncStorage JSON blob per brand,
  `getPreference(brand, key, fallback)` / `setPreference(brand, key, value)` /
  `clearPreferences(brand)`, schema-versioned, junk-tolerant.
- Wire the resets that annoy: convert screen trace threshold/line weight,
  editor brush size/color, builder sheet template, placement initial width.
  Each reads its preference on mount and writes on change (debounced where
  values slide).
- Settings gains "Session defaults" with a reset button.

**Gate** preference round-trip, junk tolerance, per-brand isolation.

## Wave 4 — Batch conversion

**Branch** `agent/batch-convert`

- Convert screen gains **Batch** entry: `ImagePicker` with
  `allowsMultipleSelection: true` (shipped API), cap ~12.
- Each photo runs the current trace preset through `stencilize`; results
  render in a keep/discard grid with per-item retry; optional "auto clean"
  toggle runs `applyCleanup`-equivalent on the traced mask via the existing
  vector pipeline only when tracing to vector — raster batch keeps it simple:
  speck suppression via stencil options.
- Keepers land in the library through `addToLibrary` with a shared tag
  (`batch-<date>`), leaning on Wave A tags.
- Pure helper `mobile/src/lib/batch.ts` for queue state (pending/done/failed,
  keep flags) so the sequencing logic is testable.

**Gate** queue reducer tests: advance, fail, retry, keep/discard, summary.

## Wave 5 — Vector node editor

**Branch** `agent/node-editor`

- New pure `mobile/src/lib/nodeEdit.ts`: `movePoint(layer, strokeIndex,
  pointIndex, x, y)`, `deletePoint(...)` (dropping a stroke below 2 points
  removes it), `insertMidpoint(layer, strokeIndex, segmentIndex)`,
  `nearestPoint(layer, x, y, radius)` hit-testing.
- Editor gains a **Nodes** tool (only enabled when a stroke layer is
  selected): renders handles for the selected stroke's points scaled to
  stage coordinates, pan gesture drags the grabbed point live, tap on a
  handle with the eraser sub-mode deletes, tap on a segment inserts.
  Commits on gesture end — one drag, one undo.
- Dense traces have thousands of points: handles render only for the stroke
  nearest the last tap, not the whole layer.

**Gate** move/delete/insert tests incl. stroke removal at <2 points,
hit-testing radius, canvas-space round-trip with layer transforms.

## Owner-gated

1. Remix verb wording — taste; shipped set is a starting point.
2. Proof PDF look — brand styling judged on a real print.
3. Node handle size/feel — needs thumbs on glass.
