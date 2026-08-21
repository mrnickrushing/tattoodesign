# Casting trays — design to 3D printer

## Status — flat trays and two-part ball molds, both carrying the drawing

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

- **A flare that gives way instead of giving up.** In a notch narrower than
  twice the flare, the two walls run past each other and the edges between them
  come out pointing backwards. That used to fail the whole offset — measured on
  real line art it is 56 edges in 1390, and the other 96% were thrown away with
  them. Now the vertices on a reversed edge give way, together, to the most they
  can both take, and the rest of the outline keeps the full flare.

  Only while a loop is *expanding*. Contracting is the opposite case: a 4mm
  square closed in by 3 from every side has no inside left, and a loop with no
  inside left has to be refused, not talked down to a smaller one that was never
  there. Which is happening is the sign of the distance against the sign of the
  winding — a hole handed a positive distance is contracting, because that is
  what growing the solid around it means.

  This was written up here as wanting *polygon booleans* — clip the offset
  against itself and keep the valid loops. Measuring first said otherwise, and
  said something better: a boolean would fill the notch between two arms of a
  snowflake with solid plastic and weld them together at the base. That is the
  same failure the tray already guards against between neighbouring shapes, and
  no more welcome for happening inside one shape. Giving way keeps the drawing.

- **Two-part molds** (`dome.ts`, `sphereMold.ts`). A cake pop is a ball on a
  stick and a truffle is a ball, and neither is a prism of anything — there is
  no flat face to stand on and no one-piece silicone mold you could peel off
  one. So it comes as **two trays**: pour each, cure each, and close the two
  blocks onto each other.

  The second tray is the first one mirrored, and that is the whole trick for
  making the halves line up. Turning a cured block over to face its partner
  mirrors it, so a mirrored tray cancels that out and every cavity lands back on
  its opposite number — no symmetry demanded of the layout, odd counts and short
  rows included.

  Registration is four keys, a corner each: pins on one half, and on the other a
  pocket built rather than subtracted — the floor cut for it with a thinner slab
  laid underneath, because nothing here does booleans. Three keys would locate
  the halves; the fourth is what stops anybody closing the mold the wrong way
  round and only finding out after it sets.

  The drawing is pressed onto the dome from directly above, the way a round
  sticker goes onto a ball: the middle of the drawing lands on the pole
  undistorted and its rim reaches the equator.

  How round the ball is built comes from **how far a flat facet strays from the
  ball**, not how long the facet is. Facet length against the nozzle was the
  first rule here and it is the wrong physics: it demands 256 facets and 33,000
  triangles a ball to buy an accuracy of one and a half microns, on a printer
  laying two-tenths of a millimetre. Chord deviation asks for 44, and the ball
  is still inside a twentieth of a millimetre of true. Relief is the real reason
  to go finer — the drawing is only as sharp as the facets under it — so only
  the half that carries a drawing pays for them.

- **An assumed printer, said out loud.** Nozzle and bed default to 0.4mm and
  220mm, and every limit in both files is measured against that nozzle. Until a
  real one is set, the findings now say they are assuming it. Deliberately *not*
  a warning: marking it one would put "Export anyway" on every export until a
  printer is bought, which is how a person learns to click past warnings — and
  the warnings here are the whole point.

## Seven things that were only visible in the arithmetic

None of these show up in a render, which is why the property test — 60 random
masks built and weighed — is the gate that matters.

1. **A bridge that grazes a vertex** pinches the polygon so no ear can ever be
   clipped there. Triangulation stops partway and reports nothing.
2. **Two shapes touching at a corner** chain into a figure of eight, which
   encloses exactly the right area and is no kind of polygon.
3. **A collinear sliver must stay** even though it covers nothing — its three
   edges are three real edges, and dropping one tears three holes in a surface
   that was closed.
4. **Two solids built on the same corners.** The pocket under a registration
   key started out sharing its outline with the hole in the floor above it,
   vertex for vertex. Parts of a tray overlap all over and the slicer unions
   them happily — but two faces built on the *same* corners are a different
   thing: the edges pair off against each other instead of against their own
   solid, and the assembled file reads as open. A hair of difference fixes it.
   The pour channel had the same shape of fault for a different reason: routed
   along the floor to the nearest wall, the channel from a back-row ball ran
   straight through the ball in front of it. It goes up through the back now,
   which has nothing in its way whatever the layout.
5. **A body counted twice under its own skirt.** Both are closed meshes over the
   same footprint, and `meshVolume` sums them without seeing the overlap — so
   the tray quoted 9% *less* silicone than it needed. The body now starts at the
   top of the skirt rather than at the floor. A slicer forgives that overlap;
   somebody standing at a bench measuring rubber does not.
6. **A tray that was open, and had been all along.** Ear clipping drops a
   vertex it reads as flat — but the walls are raised on the loop the caller
   handed in, which still goes by way of that vertex. The cap spans straight
   across, three edges have nothing to pair against, and the solid is open along
   a seam nobody drew. Whether a corner reads as flat comes down to rounding,
   and rounding comes down to where the shape stands, so a tray of one cavity
   was sound and a tray of three was not. On generated line art it was **6 trays
   in 40**. A flat vertex now leaves a sliver behind it, which covers no area
   and carries the two edges the walls need; and `extrudeBetween` checks its own
   work before handing it over, so what it cannot close it returns nothing for
   and the caller counts it.
7. **A loop that touches itself is not simple**, though nothing about it
   crosses. `isSimplePolygon` compared edges for strict crossings, so an offset
   that grew two parts of a shape into contact came back clean, and the walls
   raised on it carried zero-area faces. Touching now counts: a repeated vertex,
   a vertex on a far edge, a collinear overlap.

## What is not built

- **The far side of a ball.** The drawing goes on one half and the other is
  smooth, which is how a cake pop is decorated — it has a front. A design that
  wrapped the whole ball would have to be split across both hemispheres and
  meet itself at the equator, and nothing here does that.
- **Crowned pieces.** A domed cookie is a sphere as far as `curveWarp` is
  concerned, but it is a small cap of a very large one rather than a ball, so it
  goes down the flat-tray road and casts with a flat top. `isBall` is the line
  between the two: a ball's circumference is its own width times pi, a domed
  cookie's is nothing like it.

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
