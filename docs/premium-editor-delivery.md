# Premium editable studios delivery

## Status — milestone complete

All three waves shipped in a single PR: "feat: add premium editable studio
workflow" (#16, 2026-08-19), which bumped the native runtime to 1.3.0 for
`expo-secure-store`/`expo-crypto`. Later PRs (#17-#40, tracked under the other
wave-plan docs) extended individual pieces — client projects gained
appointments/sizes (#30), approval-proof PDF shipped its own dedicated wave
(#33) — but the foundation described below (editable projects, full-screen
editor, variation board, client folders, review packets, camera proof
comparison, surface warp, production checks, encrypted backup/restore) was
all delivered here. The one gap: no dedicated crypto round-trip / malformed
-archive test file for `encryptedBackup.ts` (see Wave 3 gates).

## Objective

Turn both Inkline and Sugar Haus into premium, offline-first creative workspaces
where generated, converted, imported, and sheet-bound artwork stays editable at
full resolution. Preserve the current generate -> trace -> sheet -> print path,
stable design IDs, exact physical sizing, and existing printer profiles.

## Replacement audit

### Entry points

- `mobile/src/app/[brand]/generate.tsx` owns the raw and stencil outputs.
- `mobile/src/app/[brand]/convert.tsx` owns the source and line-art outputs.
- `mobile/src/app/[brand]/builder.tsx` owns the library, saved sheets, and the
  only current `DesignEditor` entry point.
- `mobile/src/components/DesignEditor.tsx` is a native Skia modal. It currently
  accepts a file URI and emits one flattened PNG.

### Contracts that must survive

- `LibraryDesign.id` is the identity referenced by sheet items.
- `replaceInLibrary` must keep that ID so existing sheet placements follow an
  edit.
- Library image bytes live in per-brand document directories; AsyncStorage is
  metadata only.
- Saved sheets store exact inch-based position, size, rotation, mirror, and
  lock state.
- Browser preview cannot execute the native Skia editing surface, but all
  surrounding entry points and fallback UI must remain renderable.

### Existing interactions to preserve

- Touch-up draw/erase, crop, cut-line generation, save copy, and replace.
- Sheet move, pinch resize, twist rotate, duplicate, mirror, lock, nudge,
  align, snap, guides, autosave, saved sheets, tiled print, and printer studio.
- Per-brand libraries, generated/converted provenance, full-screen preview,
  placement preview, Sugar Haus icing preview, rename/share/delete.

### Existing visual system to preserve

- `theme.background`, `surface`, `surfaceAlt`, `stock`, `foreground`, `muted`,
  `line`, `accent`, and `accentText` are the shared color contract.
- `SPACE`, `RADIUS`, display/body fonts, compact uppercase field labels, cards,
  chips, haptics, and large touch targets define the current premium language.

## Wave 1 - editable project foundation and premium shared editor

### Data

- Add a versioned `EditableDesignProject` manifest keyed by brand and stable
  design ID.
- Migrate legacy PNGs lazily into one-layer projects without changing IDs.
- Store vector-like strokes, shapes, text, per-layer transforms, visibility,
  lock, opacity, and naming as metadata.
- Keep flattened PNG previews for the library, sheets, printing, and sharing.
- Add bounded undo/redo snapshots and project autosave.

### Editor

- Replace the current three-tool modal with a full-screen canvas workspace.
- Add selection and direct transforms, a contextual tool dock, layers panel,
  draw/erase controls, shape/text insertion, crop, line/cut controls, duplicate,
  flatten/delete, visibility/lock/opacity, grid, history, compare, and
  high-resolution save/copy/export.
- Open the editor directly from Generate raw/stencil and Convert source/result,
  as well as the existing library and sheet paths.

### Gates

- Unit tests for project migration, history, layer mutations, and SVG export.
- Mobile lint, TypeScript, unit tests, Expo dependency check, and web export.
- Browser walkthrough of both brands and all editor entry points/fallbacks.

## Wave 2 - professional project workflow

- AI variation board with explicit cost/count and selected comparisons.
- Project/client folders with references, notes, versions, status, and design
  membership.
- Review packet export and local approval/note tracking; public review links
  remain gated on durable authenticated object storage.
- Camera proof comparison with resolution, framing, and visible-line coverage metrics.
- Cylindrical surface warp preview and full-resolution application.
- Brand-specific production checks for stencil readability and Sugar Haus
  contour/piping feasibility.

### Gates

- Pure-function tests for quality analysis, warp bounds, production findings,
  folder serialization, and review packets.
- Mobile lint, TypeScript, tests, web export, and browser walkthrough.

## Wave 3 - encrypted portability, polish, and release

- AES-GCM backup archives with keys held in SecureStore.
- Restore/import with schema validation, scoped path checks, and project/image
  migration.
- Files/AirDrop device transfer, backup status, and recovery UI.
- Empty/error/loading/accessibility polish, docs, changelog, and migration tests.
- Because Expo Crypto and SecureStore are native modules, bump app/runtime and
  complete a matching production iOS build, TestFlight submission, and OTA.

### Gates

- Crypto round-trip and malformed-archive tests where the runtime permits.
- Full mobile/web checks, EAS native build, exact-build TestFlight submission,
  production iOS OTA, and runtime/fingerprint verification.

## Owner-gated boundary

A durable public client-review link needs authenticated object storage and a
retention policy. No such service or credentials exist in this repository.
Wave 2 therefore ships complete private review packets and local review state;
it does not present unreliable ephemeral server storage as a durable public URL.
