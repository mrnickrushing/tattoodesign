# Inkline product improvement backlog

## Status — audited 2026-08-20

Implementation outran this doc, same failure mode as `premium-editor-delivery.md`:
16 of 18 items below were already shipped (dates/PRs cited inline) and nobody
came back to mark them. Two are now marked **out of scope** — this is a
2-person app (Nick + Allison), never public, so a template marketplace and a
multi-role team workspace don't apply. What's left as a genuine, unbuilt
backlog is just **two items: #2 and #5.**

## Now — highest product value

1. **Studio dashboard with recent work — shipped.**
   `src/app/[brand]/index.tsx` (`recentDesigns`, `recentSheets`, resume-in-one-tap).

2. **Visual starter templates — not started.**
   - Add illustrated prompt presets for common tattoo compositions and bakery themes.
   - Preview the expected composition before generation instead of listing only a style name.
   - Include seasonal Sugar Haus packs and traditional/fine-line Ink Lab packs.

3. **Search, tags, favorites, and folders — shipped.**
   `libraryFilter.ts` (`favoritesOnly`, `tag`, free-text), part of PR #27.

4. **AI variations and remix — shipped.**
   `remix.ts` (`REMIX_VERBS`, `applyRemixVerb`), PR #32.

5. **Better first-run experience — not started.**
   - Offer a sample project for each studio and a short guided path through Generate → Edit → Sheet.
   - Keep tutorials dismissible and available again from Settings.
   - No onboarding/tutorial/first-run code exists anywhere in `src/` yet.

## Next — professional workflow upgrades

6. **Client and order projects — shipped.**
   `clientProjects.ts` carries client name, placement, dimensions, appointment
   date, and reference notes, PR #30.

7. **Shareable approval proofs — shipped.**
   `proofSheet.ts` renders a branded PDF with true dimensions and an
   approved/revision-needed status, PR #33.

8. **Vector export — shipped.**
   `projectToSvg` (`designProject.ts`) wired into `DesignEditor.tsx`; PDF
   export via `printing.ts` (`Print.printToFileAsync`).

9. **Batch conversion — shipped.**
   `batch.ts` (`BATCH_LIMIT = 12`, queue states), PR #35.

10. **Non-destructive version history — shipped.**
    `designProject.ts` snapshots (`snapshotProject`, bounded to the last 7) +
    `VersionHistory.tsx`.

11. **Reusable brand presets — shipped.**
    `preferences.ts` (`createPreferenceStore`), PR #34.

12. **Cloud backup and device sync — shipped.**
    `encryptedBackup.ts` (AES-256-GCM, key in SecureStore) plus
    `librarySync.ts`/`syncPlan.ts` for phone/iPad/browser sync.

## Later — expansion opportunities

13. **Apple Pencil and stylus editing — shipped.**
    `penInput.ts` conditions stroke width on pressure and tilt.

14. **Live placement preview — shipped.**
    `PlacementPreview.tsx`'s `"live"` mode uses `expo-camera`'s `CameraView`,
    plus a healed-preview overlay via `simulateHealing`.

15. **Smart cleanup assistant — shipped.**
    `cleanup.ts` (`findSpecks`, `bridgeGaps`, `applyCleanup`), PR #29.

16. **Template marketplace or studio packs — out of scope.**
    Personal 2-person app; creator submissions, licensing, and moderation
    have no audience here.

17. **Team workspace — out of scope.**
    No designer/artist/front-desk roles to hand off between when the whole
    team is Nick and Allison.

18. **Production checklist — shipped.**
    `productionTools.ts` (`inspectProduction`), `spacing.ts` (blowout /
    minimum-line-spacing check), `icingRecipe.ts`.

## What's actually left

Just #2 (illustrated starter-template previews) and #5 (first-run
walkthrough). Both are small enough to plan and ship as a single wave
whenever they're worth doing — there's no professional-workflow milestone
left to sequence toward, that already shipped.
