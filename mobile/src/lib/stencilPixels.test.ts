import test from "node:test";
import assert from "node:assert/strict";
import {
  boxBlur,
  buildMask,
  dilate,
  isPlainSubject,
  sobelMagnitude,
  suppressBackground,
  toGrayscale,
  DEFAULT_STENCIL_OPTIONS,
} from "./stencilPixels";

/** An RGBA buffer from a function of x and y. */
function rgba(width: number, height: number, at: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * width + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** A greyscale plane from a function of x and y. */
function plane(width: number, height: number, at: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = at(x, y);
  return out;
}

test("grey is the luminance the eye sees, not the average of the channels", () => {
  // Green carries most of the brightness and blue almost none. Averaging the
  // channels would make a saturated green and a saturated blue equally dark,
  // and they are nothing alike to look at.
  const pixels = rgba(3, 1, (x) => ([[255, 0, 0], [0, 255, 0], [0, 0, 255]] as const)[x] as [number, number, number]);
  const grey = toGrayscale(pixels);

  assert.ok(Math.abs(grey[0] - 255 * 0.299) < 1e-3, `red came out ${grey[0]}`);
  assert.ok(Math.abs(grey[1] - 255 * 0.587) < 1e-3, `green came out ${grey[1]}`);
  assert.ok(Math.abs(grey[2] - 255 * 0.114) < 1e-3, `blue came out ${grey[2]}`);
  assert.ok(grey[1] > grey[0] && grey[0] > grey[2], "green reads brightest and blue darkest");

  // One value per pixel, not per channel.
  assert.equal(grey.length, 3);
});

test("a flat field sampled from the corners is blanked, and the subject is not", () => {
  // A dark subject in the middle of a pale wall. The corners agree on the
  // wall; nothing else should move.
  const wall: [number, number, number] = [200, 198, 202];
  const subject: [number, number, number] = [40, 38, 44];
  const width = 9;
  const height = 9;
  const middle = (x: number, y: number) => x > 2 && x < 6 && y > 2 && y < 6;
  const pixels = rgba(width, height, (x, y) => (middle(x, y) ? subject : wall));

  const cleaned = suppressBackground(pixels, width, height);
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [cleaned[i], cleaned[i + 1], cleaned[i + 2]];
  };
  assert.deepEqual(at(0, 0), [255, 255, 255], "the corner itself went white");
  assert.deepEqual(at(8, 4), [255, 255, 255], "and so did the rest of the field");
  assert.deepEqual(at(4, 4), [40, 38, 44], "the subject is untouched");

  // The source is not modified in place — the caller may still want it.
  assert.equal(pixels[0], 200, "the original buffer was written to");
});

test("a field close to the corners goes too, and one far from them stays", () => {
  // The cutoff is deliberately loose enough to take a slightly uneven wall and
  // tight enough to keep pale artwork. Both sides of that are worth pinning.
  const width = 4;
  const height = 4;
  const near = rgba(width, height, (x, y) => (x === 2 && y === 2 ? [200, 200, 200] : [180, 180, 180]));
  const far = rgba(width, height, (x, y) => (x === 2 && y === 2 ? [120, 120, 120] : [180, 180, 180]));

  const nearOut = suppressBackground(near, width, height);
  const farOut = suppressBackground(far, width, height);
  const centre = (buf: Uint8Array) => buf[(2 * width + 2) * 4];

  assert.equal(centre(nearOut), 255, "a shade off the wall counts as wall");
  assert.equal(centre(farOut), 120, "something clearly darker is kept");
});

test("blur divides by the neighbours it actually had", () => {
  // The corner of a picture has a quarter of a window inside the image. Divide
  // by the whole window and the edge darkens — and a dark rim is exactly what
  // the next step reads as a line, which is the one thing blurring is for.
  const width = 5;
  const height = 5;
  const flat = plane(width, height, () => 100);
  const blurred = boxBlur(flat, width, height, 1);

  for (let i = 0; i < blurred.length; i++) {
    assert.ok(Math.abs(blurred[i] - 100) < 1e-4, `pixel ${i} came out ${blurred[i]} on a flat field`);
  }
});

test("blur averages, and a radius of nothing is a no-op", () => {
  const width = 3;
  const height = 3;
  const spike = plane(width, height, (x, y) => (x === 1 && y === 1 ? 90 : 0));

  const blurred = boxBlur(spike, width, height, 1);
  // The middle sees all nine, so 90 spread over nine.
  assert.ok(Math.abs(blurred[1 * 3 + 1] - 10) < 1e-4, `middle came out ${blurred[4]}`);
  // A corner sees four, one of which is the spike.
  assert.ok(Math.abs(blurred[0] - 90 / 4) < 1e-4, `corner came out ${blurred[0]}`);
  // Nothing is created or lost, only spread.
  const before = spike.reduce((a, b) => a + b, 0);
  assert.ok(blurred.reduce((a, b) => a + b, 0) > before, "a spike spreads out over more pixels than it started in");

  assert.equal(boxBlur(spike, width, height, 0), spike, "radius zero hands the same array back");
});

test("Sobel finds an edge where the picture changes and nothing where it does not", () => {
  const width = 7;
  const height = 7;
  // A hard vertical boundary down the middle.
  const step = plane(width, height, (x) => (x < 3 ? 0 : 255));
  const edges = sobelMagnitude(step, width, height);

  const at = (x: number, y: number) => edges[y * width + x];
  assert.ok(at(3, 3) > 200, `the boundary read ${at(3, 3)}`);
  assert.ok(at(1, 3) < 1, `flat ground on the dark side read ${at(1, 3)}`);
  assert.ok(at(5, 3) < 1, `flat ground on the pale side read ${at(5, 3)}`);

  // A picture with nothing in it has no edges at all.
  const flat = sobelMagnitude(plane(width, height, () => 128), width, height);
  assert.ok(Math.max(...flat) < 1e-6, "a flat field produced an edge");
});

test("Sobel is normalised against the picture's own strongest edge", () => {
  // So the threshold means the same thing on a faint pencil sketch as on a
  // high-contrast photograph. A gentle gradient and a hard step both peak at
  // the top of the range.
  const width = 7;
  const height = 7;
  const hard = sobelMagnitude(plane(width, height, (x) => (x < 3 ? 0 : 255)), width, height);
  const faint = sobelMagnitude(plane(width, height, (x) => (x < 3 ? 120 : 130)), width, height);

  assert.ok(Math.max(...hard) > 254, `hard edge peaked at ${Math.max(...hard)}`);
  assert.ok(Math.max(...faint) > 254, `faint edge peaked at ${Math.max(...faint)}`);
});

test("the one-pixel border is left alone, because a 3x3 has nothing to read there", () => {
  const width = 5;
  const height = 5;
  const noisy = plane(width, height, (x, y) => ((x * 37 + y * 91) % 256));
  const edges = sobelMagnitude(noisy, width, height);

  for (let x = 0; x < width; x++) {
    assert.equal(edges[x], 0, `top border at ${x} was written`);
    assert.equal(edges[(height - 1) * width + x], 0, `bottom border at ${x} was written`);
  }
  for (let y = 0; y < height; y++) {
    assert.equal(edges[y * width], 0, `left border at ${y} was written`);
    assert.equal(edges[y * width + width - 1], 0, `right border at ${y} was written`);
  }
});

test("dilation thickens a line by its radius and stops at the picture's edge", () => {
  const width = 7;
  const height = 7;
  const dot = new Uint8Array(width * height);
  dot[3 * width + 3] = 1;

  const grown = dilate(dot, width, height, 1);
  assert.equal(grown.reduce((a, b) => a + b, 0), 9, "one pixel became a 3x3 block");
  assert.equal(grown[2 * width + 2], 1, "including the diagonals");
  assert.equal(grown[3 * width + 5], 0, "and no further than the radius");

  // A mark in the corner grows into the picture and not out of it.
  const corner = new Uint8Array(width * height);
  corner[0] = 1;
  assert.equal(dilate(corner, width, height, 1).reduce((a, b) => a + b, 0), 4, "a corner has four neighbours");

  assert.equal(dilate(dot, width, height, 0), dot, "radius zero hands the same array back");
});

test("dilation never loses a line it was given", () => {
  // Growing a mask can only add. A version that wrote into a fresh buffer and
  // forgot the original would look almost right and quietly thin the artwork.
  const width = 11;
  const height = 11;
  const scattered = new Uint8Array(width * height);
  for (let i = 0; i < scattered.length; i += 7) scattered[i] = 1;

  for (const radius of [1, 2, 3]) {
    const grown = dilate(scattered, width, height, radius);
    for (let i = 0; i < scattered.length; i++) {
      if (scattered[i]) assert.equal(grown[i], 1, `radius ${radius} dropped the line at ${i}`);
    }
  }
});

test("outline and fine read the edges, and fine asks for more of one", () => {
  const width = 5;
  const height = 5;
  const grey = plane(width, height, () => 128);
  // A gradient of edge strengths across the row.
  const edges = plane(width, height, (x) => x * 25);

  const outline = buildMask("outline", grey, edges, width, height, 50);
  const fine = buildMask("fine", grey, edges, width, height, 50);

  const lit = (mask: Uint8Array) => mask.reduce((a, b) => a + b, 0);
  assert.ok(lit(outline) > 0, "outline found nothing at all");
  assert.ok(
    lit(fine) <= lit(outline),
    `fine lit ${lit(fine)} against outline's ${lit(outline)} — its cutoff is the higher one`
  );
});

test("the tone modes read tone, and ignore the edges entirely", () => {
  const width = 14;
  const height = 14;
  // Dark on the left, pale on the right. No edge information at all.
  const grey = plane(width, height, (x) => (x < 7 ? 30 : 240));
  const noEdges = plane(width, height, () => 0);

  for (const mode of ["photocopy", "halftone", "crosshatch"] as const) {
    const mask = buildMask(mode, grey, noEdges, width, height, 60);
    let dark = 0;
    let pale = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) (x < 7 ? dark++ : pale++);
      }
    }
    assert.ok(dark > 0, `${mode} put nothing on the dark half despite having no edges to read`);
    assert.ok(dark > pale, `${mode} marked ${dark} dark against ${pale} pale`);
  }
});

test("photocopy cuts at a level, so a darker picture gives more line", () => {
  const width = 4;
  const height = 4;
  const noEdges = plane(width, height, () => 0);
  const lit = (tone: number) =>
    buildMask("photocopy", plane(width, height, () => tone), noEdges, width, height, 60).reduce((a, b) => a + b, 0);

  assert.equal(lit(250), 0, "paper stays paper");
  assert.equal(lit(20), width * height, "near black is all line");
  assert.ok(lit(100) > lit(200), "and darker gives more of it in between");
});

test("a plain subject is told apart from one rendered edge to edge", () => {
  const flat = new Uint8Array(1000).fill(200);
  assert.equal(isPlainSubject(flat), true, "a picture that barely changes is a subject on a field");

  // Texture everywhere: every step is a jump.
  const busy = Uint8Array.from({ length: 1000 }, (_, i) => (i % 2 ? 20 : 220));
  assert.equal(isPlainSubject(busy), false, "a fully textured picture read as plain");

  assert.equal(isPlainSubject(new Uint8Array(0)), true, "nothing at all is not a reason to change strategy");
});

test("the defaults describe a usable stencil", () => {
  // These are what somebody gets before touching a single control.
  const d = DEFAULT_STENCIL_OPTIONS;
  assert.ok(d.threshold > 0 && d.threshold < 255, `a threshold of ${d.threshold} is outside the range it is compared against`);
  assert.ok(d.maxDimension >= 600, "downscaling below this loses linework the artist needs");
  assert.ok(d.denoise >= 0 && d.lineWeight >= 0, "a negative radius is a no-op that reads as a setting");
  assert.equal(d.mode, "outline", "edge detection is the honest default for a photograph");
  assert.equal(d.autoDetectSource, true, "and line art should take the centreline path without being asked");
});

test("the fast blur is the square loop, to the last decimal that matters", () => {
  // The obvious implementation, kept here as the thing to be equal to.
  //
  // Two one-dimensional passes over a running total is a well-known identity
  // and also an easy one to get subtly wrong at the edges, where the window is
  // clipped and the divisor changes per pixel. Asserting the identity against
  // the loop it replaced is the only way to know it held — re-deriving the
  // separable arithmetic in the test would just be the same reasoning twice.
  const square = (src: Float32Array, width: number, height: number, radius: number): Float32Array => {
    if (radius <= 0) return src;
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += src[yy * width + xx];
            count++;
          }
        }
        out[y * width + x] = sum / count;
      }
    }
    return out;
  };

  let state = 12345;
  const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000;

  let worst = 0;
  // Shapes that are one pixel wide, one tall, square, and lopsided both ways —
  // the window is clipped differently in each, and a radius larger than the
  // picture clips on both sides at once.
  for (const [width, height] of [[1, 1], [1, 9], [9, 1], [2, 2], [5, 5], [13, 7], [7, 13], [33, 17]] as const) {
    const src = Float32Array.from({ length: width * height }, () => rand() * 255);
    for (const radius of [0, 1, 2, 3, 4, 7, 20]) {
      const fast = boxBlur(src, width, height, radius);
      const slow = square(src, width, height, radius);
      assert.equal(fast.length, slow.length, `${width}x${height} r=${radius} came back a different size`);
      for (let i = 0; i < fast.length; i++) worst = Math.max(worst, Math.abs(fast[i] - slow[i]));
    }
  }
  // Float32 storage and a running total round differently from a fresh sum.
  // A thousandth of one greylevel out of 255 is far below anything a threshold
  // could act on, and far above what a real disagreement would look like.
  assert.ok(worst < 1e-3, `worst disagreement was ${worst.toExponential(2)} greylevels`);
});
