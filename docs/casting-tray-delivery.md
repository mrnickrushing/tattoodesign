# Casting trays — design to 3D printer

## Status — spine complete; trays hold many cavities, are filleted, and carry the drawing

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
- **Fillets.** `offsetPolygon` grows a loop by moving every vertex along its
  bisector, miter-clamped so a needle-thin arm does not reach for infinity, and
  `extrudeTapered` builds the skirt between the flared foot and the true
  outline. The flare is a *maximum*: each shape is offered it, then half, then
  half again, so line art about a millimetre across gets what it can take
  rather than nothing. It is capped again by the room around each shape —
  `outlineGap` measures the closest approach between any two shapes on the tray,
  and a flare may take at most half of that less a nozzle width, because two
  shapes that grow into each other come off the printer welded into one.

- **Relief.** A filled design casts as a flat slab of its own silhouette: the
  drawing survives only as a border, and every interior line is lost. So the
  body is the filled shape and the *original* linework is extruded on top of it,
  sunk in by the weld and no more. The two inversions still cancel, so a line
  standing proud of the printed positive is a line standing proud of the
  chocolate.

  The width a relief line has to clear is **one bead, not two**. A free-standing
  wall needs two perimeters to hold itself up; a ridge on a face is held up by
  the face. Below one bead it is refused outright and the finding says the piece
  will cast plain — the same posture as the fillet floor, for the same reason.

## Five things that were only visible in the arithmetic

None of these show up in a render, which is why the property test — 60 random
masks built and weighed — is the gate that matters.

1. **A bridge that grazes a vertex** pinches the polygon so no ear can ever be
   clipped there. Triangulation stops partway and reports nothing.
2. **Two shapes touching at a corner** chain into a figure of eight, which
   encloses exactly the right area and is no kind of polygon.
3. **A collinear sliver must stay** even though it covers nothing — its three
   edges are three real edges, and dropping one tears three holes in a surface
   that was closed.
4. **A body counted twice under its own skirt.** Both are closed meshes over the
   same footprint, and `meshVolume` sums them without seeing the overlap — so
   the tray quoted 9% *less* silicone than it needed. The body now starts at the
   top of the skirt rather than at the floor. A slicer forgives that overlap;
   somebody standing at a bench measuring rubber does not.
5. **A loop that touches itself is not simple**, though nothing about it
   crosses. `isSimplePolygon` compared edges for strict crossings, so an offset
   that grew two parts of a shape into contact came back clean, and the walls
   raised on it carried zero-area faces. Touching now counts: a repeated vertex,
   a vertex on a far edge, a collinear overlap.

## What is not built

- **Two-part molds.** Cake pops and truffles are spheres; `substrate.ts` knows
  their real sizes. A sphere needs two halves with registration keys, which is
  a different solid entirely.
- **Offsets that clip themselves.** The fillet refuses a *concave* corner where
  two arms meet at a shallow angle, though filling that notch is exactly what a
  fillet ought to do there. Telling it apart from a genuine self-intersection
  needs the offset to clip itself rather than refuse — polygon booleans, a much
  larger piece of geometry. Until then, detailed line art comes back
  square-footed and is told so, which is at least true.

## The offset trap

Growing a polygon fails in a way that looks like success. A 4mm gap closed in by
3mm from every side comes back as a tidy 2mm square: wound the same way, nothing
crossing anything, and an area that has honestly shrunk. Every obvious check
passes. What gives it away is that each *edge* now points the other way — the
corners crossed the middle and came out the far side. Without that check the
mesh still closes, around the wrong ground, and nothing downstream notices.

## Verified

`npm test` (711), `tsc --noEmit`, `expo lint`, and `expo export --platform ios`
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
