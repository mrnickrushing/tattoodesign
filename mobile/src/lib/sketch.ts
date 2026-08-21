// Pointing the stencil pipeline at a bad drawing instead of a good photo.
//
// stencil.ts assumes a photograph taken square-on of something already
// high-contrast. A napkin sketch is none of those things: it is shot at an
// angle across a table, the paper carries its own shadow and often a ruled
// grid, and the artist drew the same contour three times looking for it. Feed
// that straight to stencilMask -> vectorize and you get a trapezoid full of
// tripled lines.
//
// This module is the pre-processing that has to happen first. It is pure array
// and vector math on a mask, deliberately free of Skia — the image resampling
// that consumes `deskewMatrix` lives in sketchDeskew.ts, so everything with a
// decision in it stays verifiable under `tsx --test`.

import type { Point } from "./designProject";
import { distanceToSegment } from "./spacing";
import { histogram } from "./tone";

/**
 * Otsu's threshold: the luminance that best splits the histogram in two.
 *
 * Paper against a table is a two-population image, and a fixed cutoff picks the
 * wrong one every time the light changes. Otsu finds the split that maximises
 * the variance *between* the two groups, so a sketch shot on a dark bench and
 * the same sketch on a pale one both separate correctly.
 */
export function otsuThreshold(gray: Uint8Array): number {
  const counts = histogram(gray);
  const total = gray.length;
  if (!total) return 0;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * counts[i];

  let weightBelow = 0;
  let sumBelow = 0;
  let best = -1;
  let firstBest = -1;
  let lastBest = -1;
  for (let t = 0; t < 256; t++) {
    weightBelow += counts[t];
    if (!weightBelow) continue;
    const weightAbove = total - weightBelow;
    if (!weightAbove) break;
    sumBelow += t * counts[t];
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sum - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      firstBest = t;
      lastBest = t;
    } else if (between === best) {
      lastBest = t;
    }
  }

  // Every cut across an empty valley scores identically, and taking the first
  // would press the threshold up against the dark mode. The middle of the
  // valley is the cut that survives a photo whose noise partly fills it in.
  if (firstBest < 0) return 0;
  return Math.round((firstBest + lastBest) / 2);
}

/**
 * Isolates the sheet of paper in a photograph of one.
 *
 * Thresholds on Otsu and then keeps only the largest connected bright region,
 * which throws away the highlight on a mug and the strip of wall behind the
 * bench. Holes are not filled: the drawing itself is dark and punches through,
 * but `estimatePaperQuad` reads each row's outermost pixels and never looks
 * inside, so a hole costs nothing.
 *
 * A drawn line running clear off the edge of the sheet can cut the region in
 * two, in which case this keeps the larger half and the quad comes back a
 * little tight. Better than the alternative, which is including the table.
 */
export function sheetMask(gray: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (width <= 0 || height <= 0 || gray.length < mask.length) return mask;

  const threshold = otsuThreshold(gray);
  const bright = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) bright[i] = gray[i] > threshold ? 1 : 0;

  // Flood fill with an explicit stack: a full-frame region would blow the call
  // stack long before it ran out of pixels.
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let bestSize = 0;
  let bestSeed = -1;

  for (let seed = 0; seed < bright.length; seed++) {
    if (!bright[seed] || seen[seed]) continue;
    let size = 0;
    stack.push(seed);
    seen[seed] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      size++;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0) pushNeighbor(index - 1);
      if (x < width - 1) pushNeighbor(index + 1);
      if (y > 0) pushNeighbor(index - width);
      if (y < height - 1) pushNeighbor(index + width);
    }
    if (size > bestSize) {
      bestSize = size;
      bestSeed = seed;
    }
  }

  function pushNeighbor(index: number) {
    if (!bright[index] || seen[index]) return;
    seen[index] = 1;
    stack.push(index);
  }

  if (bestSeed < 0) return mask;

  // Second pass to paint only the winner. Recording every region's members on
  // the first pass would hold the whole frame in arrays for nothing.
  seen.fill(0);
  stack.push(bestSeed);
  seen[bestSeed] = 1;
  while (stack.length) {
    const index = stack.pop()!;
    mask[index] = 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) pushNeighbor(index - 1);
    if (x < width - 1) pushNeighbor(index + 1);
    if (y > 0) pushNeighbor(index - width);
    if (y < height - 1) pushNeighbor(index + width);
  }
  return mask;
}

/**
 * A sheet of paper as it appears in the photo: four corners in source-image
 * pixels, wound tl -> tr -> br -> bl. For a rotated or perspective-skewed
 * sheet those names are nominal — what they guarantee is the winding order and
 * that `tl` is the corner nearest the image origin.
 */
export type Quad = {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
};

/** The quad's corners in winding order. */
export function quadCorners(quad: Quad): Point[] {
  return [quad.tl, quad.tr, quad.br, quad.bl];
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Andrew's monotone chain. Returns the hull counter-clockwise in maths axes,
 * which is clockwise on screen because y points down.
 */
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const sorted = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const half = (source: Point[]): Point[] => {
    const chain: Point[] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };

  return [...half(sorted), ...half(sorted.reverse())];
}

/** Twice the area of the triangle, which is all the comparison needs. */
function triangleArea2(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/**
 * Reduces a convex polygon to the indices of its four dominant corners.
 *
 * Greedy Visvalingam: repeatedly drop whichever vertex costs the least area to
 * lose. A rasterised edge arrives as a staircase of near-collinear vertices
 * whose triangles are a pixel or two each, so those go first and the four real
 * corners — each worth a large triangle — are what is left standing.
 *
 * The corners it lands on are approximate. On a shallow corner the two hull
 * vertices either side sit a pixel away, which makes the corner's own triangle
 * look as negligible as a staircase step and shaves it off early; `refineCorners`
 * below puts that back.
 */
function reduceToQuad(hull: Point[]): number[] | null {
  if (hull.length < 4) return null;
  const alive = hull.map((_, i) => i);
  while (alive.length > 4) {
    let worstIndex = 0;
    let worstArea = Infinity;
    for (let i = 0; i < alive.length; i++) {
      const previous = hull[alive[(i - 1 + alive.length) % alive.length]];
      const next = hull[alive[(i + 1) % alive.length]];
      const area = triangleArea2(previous, hull[alive[i]], next);
      if (area < worstArea) {
        worstArea = area;
        worstIndex = i;
      }
    }
    alive.splice(worstIndex, 1);
  }
  return alive;
}

/** A line as `nx * x + ny * y = c`, with (nx, ny) a unit normal. */
type Line = { nx: number; ny: number; c: number };

/**
 * Total-least-squares fit through a run of hull vertices.
 *
 * Ordinary least squares minimises vertical error and falls apart on a
 * near-vertical edge, which half of every photographed sheet has. The principal
 * eigenvector of the covariance minimises perpendicular error instead and does
 * not care which way the edge runs.
 */
function fitLine(points: Point[]): Line | null {
  if (points.length < 2) return null;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const my = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point.x - mx;
    const dy = point.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  let dx: number;
  let dy: number;
  if (Math.abs(sxy) > 1e-12) {
    const largest = (sxx + syy) / 2 + Math.hypot((sxx - syy) / 2, sxy);
    dx = largest - syy;
    dy = sxy;
  } else if (sxx >= syy) {
    dx = 1;
    dy = 0;
  } else {
    dx = 0;
    dy = 1;
  }
  const length = Math.hypot(dx, dy);
  if (!length) return null;

  const nx = -dy / length;
  const ny = dx / length;
  return { nx, ny, c: nx * mx + ny * my };
}

function intersectLines(a: Line, b: Line): Point | null {
  const determinant = a.nx * b.ny - a.ny * b.nx;
  // Near-parallel edges mean the corner is off at infinity — a sliver, not a
  // sheet, and no intersection worth trusting.
  if (Math.abs(determinant) < 1e-6) return null;
  return {
    x: (a.c * b.ny - a.ny * b.c) / determinant,
    y: (a.nx * b.c - a.c * b.nx) / determinant,
  };
}

/** Hull vertices from `start` forward to `end`, inclusive, wrapping. */
function chainBetween(hull: Point[], start: number, end: number): Point[] {
  const chain: Point[] = [];
  for (let i = start; ; i = (i + 1) % hull.length) {
    chain.push(hull[i]);
    if (i === end) break;
  }
  return chain;
}

/** Fraction of each edge's length discarded at both ends before fitting. */
const CORNER_MARGIN = 0.15;

/**
 * Drops the vertices nearest both ends of an edge run.
 *
 * Measured as a fraction of the edge's length rather than of its vertex count:
 * a near-vertical edge rasterises to a dozen staircase vertices over the same
 * distance a diagonal one spends a hundred on, and trimming by count would
 * leave the short list still carrying its neighbour's pixels.
 */
function trimEnds(run: Point[]): Point[] {
  if (run.length < 4) return run;
  const first = run[0];
  const last = run[run.length - 1];
  const margin = Math.hypot(last.x - first.x, last.y - first.y) * CORNER_MARGIN;
  if (margin <= 0) return run;
  const kept = run.filter(
    (point) =>
      Math.hypot(point.x - first.x, point.y - first.y) > margin &&
      Math.hypot(point.x - last.x, point.y - last.y) > margin
  );
  return kept.length >= 2 ? kept : run;
}

/**
 * Recovers each corner as the intersection of the two edges meeting there.
 *
 * The approximate corners are only used to decide which hull vertices belong to
 * which of the four edges; the edges themselves are hundreds of pixels of
 * evidence and locate their crossing far better than any single vertex does.
 * A margin is trimmed off both ends of every run first, so that a corner the
 * greedy pass shaved cannot leak its neighbour's pixels into this fit.
 *
 * An intersection that lands implausibly far from the vertex it replaces means
 * the "edge" was not straight — a torn or curled sheet — so the original vertex
 * stands.
 */
function refineCorners(hull: Point[], corners: number[]): Point[] {
  const approximate = corners.map((index) => hull[index]);
  const edges = corners.map((start, i) => {
    const run = chainBetween(hull, start, corners[(i + 1) % corners.length]);
    return fitLine(trimEnds(run));
  });

  const span = Math.max(
    ...approximate.map((a) => Math.max(...approximate.map((b) => Math.hypot(a.x - b.x, a.y - b.y))))
  );
  const limit = Math.max(2, span * 0.1);

  return approximate.map((vertex, i) => {
    const before = edges[(i + edges.length - 1) % edges.length];
    const after = edges[i];
    if (!before || !after) return vertex;
    const crossing = intersectLines(before, after);
    if (!crossing) return vertex;
    if (Math.hypot(crossing.x - vertex.x, crossing.y - vertex.y) > limit) return vertex;
    return crossing;
  });
}

/**
 * Puts four corners into tl/tr/br/bl order.
 *
 * Sorting by angle about the centroid fixes the winding; the cycle is then
 * rotated so the corner nearest the image origin leads. A square photographed
 * at exactly 45 degrees has two corners tied on `x + y`, so the higher one
 * wins the tie and the result stays deterministic rather than depending on
 * which pixel the hull happened to start from.
 */
function orderQuad(corners: Point[]): Quad {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  const wound = corners
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  let first = 0;
  for (let i = 1; i < wound.length; i++) {
    const candidate = wound[i].x + wound[i].y;
    const leader = wound[first].x + wound[first].y;
    if (candidate < leader || (candidate === leader && wound[i].y < wound[first].y)) first = i;
  }

  const [tl, tr, br, bl] = [0, 1, 2, 3].map((offset) => wound[(first + offset) % 4]);
  return { tl, tr, br, bl };
}

/**
 * Finds the sheet of paper in a photo.
 *
 * `mask` is one byte per pixel, non-zero where the pixel belongs to the paper
 * rather than the table behind it. Only the leftmost and rightmost set pixel
 * of each row are considered: the hull of a filled region is the hull of its
 * row extents, so this reads the whole mask but only ever hulls 2 * height
 * candidates instead of every pixel.
 *
 * Returns null when there is nothing convincing to correct — no ink, or a
 * region too thin to have four distinct corners — which callers should treat
 * as "use the photo as shot" rather than as an error.
 */
export function estimatePaperQuad(mask: Uint8Array, width: number, height: number): Quad | null {
  if (width <= 0 || height <= 0 || mask.length < width * height) return null;

  const extents: Point[] = [];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let min = -1;
    let max = -1;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (min < 0) min = x;
      max = x;
    }
    if (min < 0) continue;
    extents.push({ x: min, y });
    if (max !== min) extents.push({ x: max, y });
  }
  if (extents.length < 4) return null;

  const hull = convexHull(extents);
  const cornerIndices = reduceToQuad(hull);
  if (!cornerIndices) return null;
  const corners = refineCorners(hull, cornerIndices);

  // A degenerate result — three corners collapsed onto a line — is worse than
  // no correction at all, because the homography below would invert it.
  const quad = orderQuad(corners);
  const area = quadArea(quad);
  if (area < 1) return null;
  return quad;
}

/** Area of the quad by the shoelace formula. */
export function quadArea(quad: Quad): number {
  const corners = quadCorners(quad);
  let total = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}

/**
 * How large the corrected sheet should be, in pixels.
 *
 * Opposite edges of a photographed rectangle disagree — that disagreement is
 * the perspective — so each dimension is the mean of its two edges. Keeping
 * the output near the source's own scale means the deskew resamples rather
 * than enlarges.
 */
export function deskewSize(quad: Quad): { width: number; height: number } {
  const edge = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const width = (edge(quad.tl, quad.tr) + edge(quad.bl, quad.br)) / 2;
  const height = (edge(quad.tl, quad.bl) + edge(quad.tr, quad.br)) / 2;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Gaussian elimination with partial pivoting on an n x (n+1) augmented matrix.
 * Returns null when the system is singular, which for the homography below
 * means three of the four corners were collinear.
 */
function solveLinearSystem(rows: number[][], n: number): number[] | null {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      if (!factor) continue;
      for (let c = col; c <= n; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row, i) => row[n] / row[i]);
}

/**
 * The 3x3 homography that lays the photographed sheet flat.
 *
 * Maps a point in the source photo onto the corrected sheet, which is the
 * direction a renderer wants: `canvas.concat(matrix)` before drawing the photo
 * makes Skia resample it into a square sheet in one pass, with its own
 * filtering, rather than us walking an output grid by hand.
 *
 * Returned row-major as nine numbers with the bottom-right normalised to 1.
 * Null when the quad is degenerate — three corners on a line have no
 * perspective to undo.
 */
export function deskewMatrix(quad: Quad, outWidth: number, outHeight: number): number[] | null {
  if (outWidth <= 0 || outHeight <= 0) return null;

  const destination: Point[] = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];

  // Eight unknowns: a b c d e f g h, with i pinned to 1.
  //   u = (a*x + b*y + c) / (g*x + h*y + 1)
  //   v = (d*x + e*y + f) / (g*x + h*y + 1)
  // Multiplying out the denominator makes both rows linear in the unknowns.
  const rows: number[][] = [];
  quadCorners(quad).forEach((corner, i) => {
    const { x, y } = corner;
    const { x: u, y: v } = destination[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  });

  const solved = solveLinearSystem(rows, 8);
  if (!solved) return null;
  if (solved.some((value) => !Number.isFinite(value))) return null;
  return [...solved, 1];
}

/** Applies a row-major 3x3 homography to a point. */
export function applyMatrix(matrix: number[], point: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const w = g * point.x + h * point.y + i;
  if (!w) return { x: 0, y: 0 };
  return {
    x: (a * point.x + b * point.y + c) / w,
    y: (d * point.x + e * point.y + f) / w,
  };
}

/**
 * Whether the sheet is already square-on to the camera, within `tolerancePx`.
 *
 * Worth asking before resampling: an in-app rough drawn on the canvas is
 * already rectangular, and running it through a homography anyway costs a
 * generation of interpolation blur for no correction at all.
 */
export function isAxisAligned(quad: Quad, tolerancePx = 1): boolean {
  const { width, height } = deskewSize(quad);
  const target: Point[] = [
    { x: quad.tl.x, y: quad.tl.y },
    { x: quad.tl.x + width, y: quad.tl.y },
    { x: quad.tl.x + width, y: quad.tl.y + height },
    { x: quad.tl.x, y: quad.tl.y + height },
  ];
  return quadCorners(quad).every(
    (corner, i) => Math.hypot(corner.x - target[i].x, corner.y - target[i].y) <= tolerancePx
  );
}

/** Distance from a point to the nearest point on a polyline. */
function distanceToPath(point: Point, path: Point[]): number {
  if (!path.length) return Infinity;
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const distance = distanceToSegment(point.x, point.y, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
    if (distance < best) best = distance;
    if (!best) break;
  }
  return best;
}

/** Fraction of `path`'s vertices lying within `tolerance` of `other`. */
function coverage(path: Point[], other: Point[], tolerance: number): number {
  if (!path.length) return 0;
  let covered = 0;
  for (const point of path) if (distanceToPath(point, other) <= tolerance) covered++;
  return covered / path.length;
}

function pathLengthOf(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/**
 * How much of one path has to lie on top of another before they are judged to
 * be the same line drawn twice. Below this they are two lines that happen to
 * touch — a crossbar meeting a stem, say — and merging them would weld the
 * drawing shut.
 */
const SAME_STROKE_COVERAGE = 0.7;

/** Nearest point on a polyline, for averaging a cluster onto its spine. */
function nearestOnPath(point: Point, path: Point[]): Point | null {
  if (!path.length) return null;
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (path.length === 1) return { ...path[0] };
  return best;
}

/**
 * Collapses a sketchy multi-drawn contour into one path.
 *
 * Someone finding a line on paper draws it three or four times, and the tracer
 * faithfully returns all four. `toleranceMm` is the real-world width of that
 * searching — how far apart two attempts at the same line can sit and still be
 * the same line — so the caller passes millimetres and the printed size decides
 * the rest.
 *
 * Paths that survive as separate are returned untouched and in input order; a
 * merged cluster takes the position of its longest member, which keeps the
 * output stable when the same drawing is traced twice.
 */
export function consolidateStrokes(paths: Point[][], toleranceMm: number, pxPerMm: number): Point[][] {
  return consolidateWithin(paths, toleranceMm * pxPerMm);
}

/**
 * The same collapse, told the tolerance directly in pixels.
 *
 * A stroke coming off the tracer has no physical size yet — the mask was
 * thresholded at a working resolution and nobody has said how big the piece
 * prints. What that caller does know is the line weight it just traced at, and
 * two contours within a couple of line weights of each other are the same
 * searched line. Millimetres are the right unit for a hand drawing on a canvas
 * of known size; pixels are the right unit for a mask.
 */
export function consolidateWithin(paths: Point[][], tolerance: number): Point[][] {
  if (paths.length < 2 || tolerance <= 0) return paths.map((path) => path.slice());

  const parent = paths.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (paths[i].length < 1 || paths[j].length < 1) continue;
      // The larger of the two coverages, not the smaller: a short stroke lying
      // entirely along a long one is the same line found twice, even though
      // the long one is mostly somewhere else.
      const overlap = Math.max(
        coverage(paths[i], paths[j], tolerance),
        coverage(paths[j], paths[i], tolerance)
      );
      if (overlap >= SAME_STROKE_COVERAGE) union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  paths.forEach((_, i) => {
    const root = find(i);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(i);
    else clusters.set(root, [i]);
  });

  const merged: Point[][] = [];
  for (const [root, members] of [...clusters.entries()].sort((a, b) => a[0] - b[0])) {
    if (members.length === 1) {
      merged.push(paths[root].slice());
      continue;
    }

    let spineIndex = members[0];
    let spineLength = pathLengthOf(paths[spineIndex]);
    for (const member of members) {
      const length = pathLengthOf(paths[member]);
      if (length > spineLength) {
        spineLength = length;
        spineIndex = member;
      }
    }
    const spine = paths[spineIndex];
    const others = members.filter((member) => member !== spineIndex).map((member) => paths[member]);

    merged.push(
      spine.map((point) => {
        let x = point.x;
        let y = point.y;
        let count = 1;
        for (const other of others) {
          const near = nearestOnPath(point, other);
          // Only pull toward attempts that are actually alongside this part of
          // the spine. A member covering just the first half of a long contour
          // must not drag the second half back toward its own endpoint.
          if (!near || Math.hypot(near.x - point.x, near.y - point.y) > tolerance) continue;
          x += near.x;
          y += near.y;
          count++;
        }
        const averaged: Point = { x: x / count, y: y / count };
        if (point.w !== undefined) averaged.w = point.w;
        return averaged;
      })
    );
  }

  return merged;
}
