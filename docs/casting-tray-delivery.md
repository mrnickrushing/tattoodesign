# Casting trays — design to 3D printer

## Status — spine complete, trays hold many cavities

Allison's side of the app makes images; what she needs from them is a mold. The
workflow is: 3D print a tray, pour silicone into it, and the cured silicone is
the mold the goodies come out of.

Two things follow from that and both shape the design. Nothing printed ever
touches food, so the only food-safety requirement is food-grade silicone — the
layer lines on the print are a surface-finish question, not a hygiene one. And
the two inversions cancel: printed positive → silicone cavity → chocolate
positive. What comes out of the mold looks like what went into the printer, so
the tray previews as the goodie.

## What shipped

The blocking gap was not 3D at all. Every path in this app that turns pixels
into geometry traces a **skeleton** — `vectorize.ts` thins a shape to its
centreline, which is right for a piping tip to follow and wrong for anything
that becomes an object.

- **`contour.ts`** — closed boundaries instead. Each edge between a filled pixel
  and an empty one is emitted with the fill on its right and the segments
  chained head to tail, so a boundary and the hole inside it come out wound
  opposite ways without anything working out which is which. Also splits
  self-touching loops, groups holes with the piece they are in, and fills
  enclosed regions so an outlined snowflake stands up as a snowflake.
- **`solid.ts`** — ear-clipping triangulation with hole bridging, extruded into
  a closed surface, plus `meshVolume` and `inspectMesh` as the checks that
  matter.
- **`stl.ts`** — binary STL, in millimetres.
- **`castingTray.ts`** — floor, walls, positives, and the findings. `packCavities`
  arranges N copies of the design into the block closest to square, because a
  print bed is square and its limit is whichever way the tray ends up widest.
  The sheet builder's packers in `layout.ts` answer the opposite question —
  they shrink cells to fit a page whose size is decided — so this is its own
  function rather than a reuse.
- **`lineWidth.ts`** — how fine the finest line actually is, shared with the
  skin-tone warning that needed the same measurement.

## Three things that were only visible in the arithmetic

None of these show up in a render, which is why the property test — 60 random
masks built and weighed — is the gate that matters.

1. **A bridge that grazes a vertex** pinches the polygon so no ear can ever be
   clipped there. Triangulation stops partway and reports nothing.
2. **Two shapes touching at a corner** chain into a figure of eight, which
   encloses exactly the right area and is no kind of polygon.
3. **A collinear sliver must stay** even though it covers nothing — its three
   edges are three real edges, and dropping one tears three holes in a surface
   that was closed.

## What is not built

- **Fillets at the base of each positive.** A sharp interior corner is where
  silicone tears first on demolding.
- **Relief detail.** Interior linework raised on the top face, rather than the
  silhouette alone standing up.
- **Two-part molds.** Cake pops and truffles are spheres; `substrate.ts` knows
  their real sizes. A sphere needs two halves with registration keys, which is
  a different solid entirely.
- **Fillets.** See above — the one physical concern still unaddressed.

## Verified

`npm test` (690), `tsc --noEmit`, `expo lint`, and `expo export --platform ios`
clean.

A 2.5-inch snowflake, 7mm thick:

| Cavities | Grid | Tray | Filament | Silicone |
|---|---|---|---|---|
| 1 | 1 × 1 | 66 × 61 × 13mm | 20cm³ | 31ml |
| 6 | 2 × 3 | 121 × 162 × 13mm | 76cm³ | 179ml |
| 12 | 3 × 4 | 177 × 212 × 13mm | 133cm³ | 355ml |

All watertight; twelve just fits a 220mm bed. Asking for more than fits reports
how many *would*, and that number is checked against the packer rather than
estimated from the ratio of the areas — the grid rearranges at every count, so
the ratio is wrong.

A three-inch snowflake passes the detail check at 0.95mm; the same design at
two inches correctly refuses, its arms coming out 0.63mm against the 0.8mm a
0.4mm nozzle can lay down.

Untested by machine: the export button itself, which needs a device and a
printer.
