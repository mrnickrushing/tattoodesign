import test from "node:test";
import assert from "node:assert/strict";
import {
  PLACEMENTS,
  allocateCounts,
  detailDensity,
  estimateHours,
  findPlacement,
  icingPlan,
  planBatch,
  quote,
  type BatchDesign,
  type QuoteInput,
} from "./quote";

const BASE: QuoteInput = {
  widthIn: 4,
  heightIn: 5,
  density: 0.5,
  placement: "forearm",
  hourlyRate: 180,
};

test("every placement is at least as slow as a forearm", () => {
  assert.equal(findPlacement("forearm")?.difficulty, 1, "the forearm is the baseline");
  PLACEMENTS.forEach((placement) => {
    assert.ok(placement.difficulty >= 1, `${placement.id} came in under the baseline`);
    assert.ok(placement.difficulty <= 2, `${placement.id} is implausibly slow`);
    assert.ok(placement.note.length > 0, `${placement.id} has no reason given`);
  });
  const ids = PLACEMENTS.map((placement) => placement.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate placements");
});

test("an unknown placement quotes as an easy one rather than failing", () => {
  assert.equal(findPlacement("earlobe"), undefined);
  const unknown = estimateHours({ ...BASE, placement: "earlobe" as QuoteInput["placement"] });
  assert.equal(unknown, estimateHours({ ...BASE, placement: "forearm" }));
});

test("more area never quotes fewer hours", () => {
  let previous = 0;
  for (let inches = 1; inches <= 20; inches++) {
    const hours = estimateHours({ ...BASE, widthIn: inches, heightIn: inches });
    assert.ok(hours >= previous, `${inches}in square quoted less than the size below it`);
    previous = hours;
  }
});

test("more detail never quotes fewer hours", () => {
  let previous = 0;
  for (let density = 0; density <= 1.0001; density += 0.05) {
    const hours = estimateHours({ ...BASE, density });
    assert.ok(hours >= previous, `density ${density.toFixed(2)} quoted less than the one below it`);
    previous = hours;
  }
});

test("a harder placement never quotes fewer hours", () => {
  const sorted = [...PLACEMENTS].sort((a, b) => a.difficulty - b.difficulty);
  let previous = 0;
  for (const placement of sorted) {
    const hours = estimateHours({ ...BASE, placement: placement.id });
    assert.ok(hours >= previous, `${placement.id} quoted less than an easier placement`);
    previous = hours;
  }
});

test("out-of-range detail is clamped, not extrapolated", () => {
  assert.equal(estimateHours({ ...BASE, density: 4 }), estimateHours({ ...BASE, density: 1 }));
  assert.equal(estimateHours({ ...BASE, density: -3 }), estimateHours({ ...BASE, density: 0 }));
});

test("a piece with no size is not a job", () => {
  assert.equal(estimateHours({ ...BASE, widthIn: 0 }), 0);
  assert.equal(estimateHours({ ...BASE, heightIn: -2 }), 0);
  assert.equal(estimateHours({ ...BASE, widthIn: Number.NaN }), 0);
  assert.deepEqual(quote({ ...BASE, widthIn: 0 }), { hours: 0, subtotal: 0, lines: [] });
});

test("setup is charged once and is not scaled by placement", () => {
  // A vanishingly small piece is all setup, wherever it goes.
  const tiny = { ...BASE, widthIn: 0.01, heightIn: 0.01, density: 0 };
  assert.equal(estimateHours(tiny), 0.5);
  assert.equal(estimateHours({ ...tiny, placement: "hand" }), 0.5, "setup is setup");
});

const SETUP_HOURS = 0.5;
const BOOKING_STEP = 0.25;

test("the placement multiplier is applied exactly once", () => {
  // A large piece, so that rounding to the quarter hour is a rounding error
  // rather than most of the difference. Both figures carry the same flat setup,
  // so the multiplier shows only on the working half — applied twice this lands
  // near 2.25x rather than 1.5x.
  const big = { ...BASE, widthIn: 20, heightIn: 20 };
  const forearm = estimateHours({ ...big, placement: "forearm" });
  const ribs = estimateHours({ ...big, placement: "ribs" });
  const difficulty = findPlacement("ribs")!.difficulty;

  const ratio = (ribs - SETUP_HOURS) / (forearm - SETUP_HOURS);
  assert.ok(Math.abs(ratio - difficulty) < 0.02, `working hours scaled by ${ratio.toFixed(3)}, expected ${difficulty}`);
});

test("applied once at every size, to within a booking slot", () => {
  // The same property stated so it survives the quarter-hour rounding: at any
  // size, the harder placement is the easier one's working hours times the
  // multiplier, off by no more than the granularity hours are booked in.
  for (const inches of [1, 2, 4, 8, 16]) {
    for (const placement of PLACEMENTS) {
      const size = { ...BASE, widthIn: inches, heightIn: inches };
      const easy = estimateHours({ ...size, placement: "forearm" });
      const actual = estimateHours({ ...size, placement: placement.id });
      const predicted = (easy - SETUP_HOURS) * placement.difficulty + SETUP_HOURS;
      assert.ok(
        Math.abs(actual - predicted) <= BOOKING_STEP,
        `${placement.id} at ${inches}in: ${actual}h against a predicted ${predicted.toFixed(3)}h`
      );
    }
  }
});

test("hours are booked in quarters", () => {
  for (const inches of [2, 3, 5, 7, 11]) {
    const hours = estimateHours({ ...BASE, widthIn: inches, heightIn: inches });
    assert.equal(hours * 4, Math.round(hours * 4), `${hours} is not a bookable time`);
  }
});

test("a quote bills the hours at the rate, and says so", () => {
  const result = quote(BASE);
  assert.equal(result.subtotal, result.hours * 180);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].amount, result.subtotal);
  assert.ok(result.lines[0].detail.includes("180/h"));
  assert.ok(result.lines[0].detail.includes("no surcharge"), "a forearm is not surcharged");
});

test("a hard placement is explained rather than billed twice", () => {
  const result = quote({ ...BASE, placement: "ribs" });
  assert.equal(result.lines.length, 1, "no separate surcharge line");
  assert.equal(result.subtotal, result.hours * 180, "the total is hours times rate, nothing else");
  assert.ok(result.lines[0].detail.includes("50% longer"), `expected the reason: ${result.lines[0].detail}`);
});

test("a shop minimum tops up a small sitting and never discounts a large one", () => {
  const small = quote({ ...BASE, widthIn: 1, heightIn: 1, minimum: 250 });
  assert.equal(small.subtotal, 250);
  assert.equal(small.lines.length, 2);
  assert.equal(small.lines[0].amount + small.lines[1].amount, 250, "the lines add up to the total");

  const large = quote({ ...BASE, minimum: 250 });
  assert.ok(large.subtotal > 250);
  assert.equal(large.lines.length, 1, "a real sitting does not get a minimum line");
});

test("detail density comes out of what the spacing check measured", () => {
  assert.equal(detailDensity({ violations: 0, worstGapMm: null, checkedSegments: 0 }), 0, "nothing measured");
  assert.equal(detailDensity({ violations: 0, worstGapMm: null, checkedSegments: 400 }), 0, "open linework");
  assert.equal(detailDensity({ violations: 100, worstGapMm: 0.4, checkedSegments: 400 }), 0.25);
  assert.equal(detailDensity({ violations: 9000, worstGapMm: 0.1, checkedSegments: 400 }), 1, "clamped");
});

const COOKIE: BatchDesign = {
  id: "snowflake",
  label: "Snowflake",
  count: 100,
  widthIn: 3,
  heightIn: 3,
  colours: [
    { hex: "#FFFFFF", label: "White", weight: 3 },
    { hex: "#8FD3F4", label: "Ice blue", weight: 1 },
  ],
};

test("icing scales linearly with the order", () => {
  const hundred = icingPlan([COOKIE], 100);
  const twoHundred = icingPlan([COOKIE], 200);
  assert.equal(hundred.length, 2);
  hundred.forEach((line, i) => {
    assert.equal(twoHundred[i].hex, line.hex);
    assert.ok(
      Math.abs(twoHundred[i].exactCups - line.exactCups * 2) < 1e-9,
      `${line.label}: ${twoHundred[i].exactCups} is not twice ${line.exactCups}`
    );
  });
});

test("icing splits by weight and is measured out in quarter cups", () => {
  const [most, least] = icingPlan([COOKIE], 100);
  assert.equal(most.label, "White");
  assert.ok(Math.abs(most.exactCups / least.exactCups - 3) < 1e-9, "3:1 white to blue");
  assert.equal(most.cups * 4, Math.round(most.cups * 4), "a measurable amount");
  assert.ok(most.cups >= least.cups, "the biggest batch is listed first");
});

test("the same colour on two designs is mixed once", () => {
  const second: BatchDesign = {
    ...COOKIE,
    id: "star",
    label: "Star",
    colours: [{ hex: "#ffffff", label: "White", weight: 1 }],
  };
  const plan = icingPlan([COOKIE, second], 0);
  assert.equal(plan.length, 2, "two colours, not three");
  const white = plan.find((line) => line.hex === "#ffffff")!;
  const blueOnly = icingPlan([COOKIE], 0).find((line) => line.label === "Ice blue")!;
  assert.ok(white.exactCups > blueOnly.exactCups, "white now carries both designs");
});

test("a quantity of zero leaves the designs' own counts alone", () => {
  assert.deepEqual(
    icingPlan([COOKIE], 0).map((line) => line.exactCups),
    icingPlan([COOKIE], 100).map((line) => line.exactCups)
  );
});

test("designs with nothing to decorate contribute no icing", () => {
  assert.deepEqual(icingPlan([], 100), []);
  assert.deepEqual(icingPlan([{ ...COOKIE, count: 0 }], 0), []);
  assert.deepEqual(icingPlan([{ ...COOKIE, widthIn: 0 }], 100), []);
  assert.deepEqual(icingPlan([{ ...COOKIE, colours: [] }], 100), [], "no colours, nothing to mix");
  assert.deepEqual(
    icingPlan([{ ...COOKIE, colours: [{ hex: "#FFFFFF", label: "White", weight: 0 }] }], 100),
    [],
    "weights that sum to zero"
  );
});

test("a batch run plans sheets, icing, hours and price together", () => {
  const run = planBatch({
    designs: [COOKIE],
    quantity: 200,
    sheetWidthIn: 8,
    sheetHeightIn: 10,
    hourlyRate: 40,
  })!;
  assert.ok(run, "the run plans");
  assert.equal(run.perDesign.length, 1);
  assert.equal(run.perDesign[0].count, 200, "the order size overrides the design's own count");
  assert.equal(run.perDesign[0].perSheet, 6, "3in cookies, six to an 8x10 sheet");
  assert.equal(run.perDesign[0].sheets, Math.ceil(200 / 6));
  assert.equal(run.sheets, run.perDesign[0].sheets);
  assert.equal(run.icing.length, 2);
  assert.ok(run.hours > 0);
  assert.equal(run.subtotal, run.hours * 40);
});

test("a bigger order is never a smaller job", () => {
  const of = (quantity: number) =>
    planBatch({ designs: [COOKIE], quantity, sheetWidthIn: 8, sheetHeightIn: 10, hourlyRate: 40 })!;
  let previousHours = 0;
  let previousSheets = 0;
  for (const quantity of [12, 24, 60, 120, 240, 480]) {
    const run = of(quantity);
    assert.ok(run.hours >= previousHours, `${quantity} pieces quoted fewer hours than the order below it`);
    assert.ok(run.sheets >= previousSheets, `${quantity} pieces needed fewer sheets`);
    previousHours = run.hours;
    previousSheets = run.sheets;
  }
});

test("more colours is more work, at the same piece count", () => {
  const plain = planBatch({
    designs: [{ ...COOKIE, colours: [{ hex: "#FFFFFF", label: "White", weight: 1 }] }],
    quantity: 100,
    sheetWidthIn: 8,
    sheetHeightIn: 10,
    hourlyRate: 40,
  })!;
  const busy = planBatch({
    designs: [COOKIE],
    quantity: 100,
    sheetWidthIn: 8,
    sheetHeightIn: 10,
    hourlyRate: 40,
  })!;
  assert.ok(busy.hours > plain.hours, "a second colour is a second pass and a second mix");
  assert.equal(plain.sheets, busy.sheets, "but not a second sheet");
});

test("cookies and an order minimum are billed on top of the labour", () => {
  const run = planBatch({
    designs: [COOKIE],
    quantity: 24,
    sheetWidthIn: 8,
    sheetHeightIn: 10,
    hourlyRate: 40,
    perPieceCost: 1.25,
    minimum: 500,
  })!;
  assert.equal(run.lines.length, 3);
  assert.equal(run.lines[1].amount, 30, "24 cookies at 1.25");
  assert.equal(run.subtotal, 500);
  assert.equal(
    run.lines.reduce((sum, line) => sum + line.amount, 0),
    500,
    "the lines add up to what is charged"
  );
});

test("a batch with nothing in it is not a run", () => {
  assert.equal(planBatch({ designs: [], quantity: 10, sheetWidthIn: 8, sheetHeightIn: 10, hourlyRate: 40 }), null);
  assert.equal(planBatch({ designs: [COOKIE], quantity: 10, sheetWidthIn: 0, sheetHeightIn: 10, hourlyRate: 40 }), null);
  assert.equal(
    planBatch({ designs: [{ ...COOKIE, count: 0 }], quantity: 0, sheetWidthIn: 8, sheetHeightIn: 10, hourlyRate: 40 }),
    null
  );
  assert.equal(
    planBatch({ designs: [{ ...COOKIE, widthIn: 99 }], quantity: 10, sheetWidthIn: 8, sheetHeightIn: 10, hourlyRate: 40 }),
    null,
    "a cookie bigger than the sheet has no packing"
  );
});

test("quote copy never leaves a token unresolved", () => {
  for (const placement of PLACEMENTS) {
    const result = quote({ ...BASE, placement: placement.id, minimum: 5000 });
    result.lines.forEach((line) => {
      assert.ok(line.label.length > 0);
      assert.ok(!/\$\{|undefined|NaN/.test(line.detail), `bad copy for ${placement.id}: ${line.detail}`);
    });
  }
  const run = planBatch({
    designs: [COOKIE],
    quantity: 50,
    sheetWidthIn: 8,
    sheetHeightIn: 10,
    hourlyRate: 40,
    perPieceCost: 1,
    minimum: 9000,
  })!;
  run.lines.forEach((line) => assert.ok(!/\$\{|undefined|NaN/.test(line.detail), line.detail));
});

test("colours chosen later are still separate colours", () => {
  // An order planned before anyone has picked the palette: three colours with
  // no hex yet. Keying those together would plan one mix for three passes.
  const unnamed: BatchDesign = {
    ...COOKIE,
    colours: [
      { hex: "", label: "Colour 1", weight: 1 },
      { hex: "", label: "Colour 2", weight: 1 },
      { hex: "", label: "Colour 3", weight: 1 },
    ],
  };
  const plan = icingPlan([unnamed], 60);
  assert.equal(plan.length, 3);
  plan.forEach((line) => assert.equal(line.recipe, null, "no hex, nothing to mix from"));
  assert.deepEqual(new Set(plan.map((line) => line.label)).size, 3);
});

test("a named colour still carries its recipe", () => {
  const [line] = icingPlan([{ ...COOKIE, colours: [{ hex: "#E86A9A", label: "Rose", weight: 1 }] }], 40);
  assert.equal(line.hex, "#e86a9a");
  assert.ok(line.recipe, "a real colour can be mixed from the gels on the shelf");
});

test("an order is split into whole pieces that add back up to it", () => {
  // Two designs of one each, scaled to three: rounding both independently
  // gives two apiece and plans a four-piece run for a three-piece order.
  assert.deepEqual(allocateCounts([1, 1], 3), [2, 1]);
  assert.deepEqual(allocateCounts([1, 1, 1], 7), [3, 2, 2]);
  assert.deepEqual(allocateCounts([3, 1], 100), [75, 25]);

  for (const quantity of [1, 3, 7, 13, 50, 199]) {
    for (const shape of [[1, 1], [1, 1, 1], [3, 1], [5, 3, 2], [1, 2, 3, 4]]) {
      const allocated = allocateCounts(shape, quantity);
      assert.equal(
        allocated.reduce((sum, count) => sum + count, 0),
        quantity,
        `${shape.join("/")} at ${quantity} did not add up`
      );
      assert.ok(allocated.every((count) => Number.isInteger(count) && count >= 0));
    }
  }
});

test("allocation is stable and leaves stated counts alone when nothing is asked for", () => {
  assert.deepEqual(allocateCounts([1, 1], 3), allocateCounts([1, 1], 3), "ties break the same way twice");
  assert.deepEqual(allocateCounts([4, 7], 0), [4, 7], "no order size means the counts stand");
  assert.deepEqual(allocateCounts([0, 0], 10), [0, 0], "nothing to allocate across");
  assert.deepEqual(allocateCounts([], 10), []);
});

test("the whole run is planned from one set of counts", () => {
  // The reviewer's case: sheets, hours and cookies must not be planned for a
  // different number of pieces than the icing is mixed for.
  const one: BatchDesign = { ...COOKIE, id: "a", label: "A", count: 1 };
  const two: BatchDesign = { ...COOKIE, id: "b", label: "B", count: 1 };
  const run = planBatch({
    designs: [one, two],
    quantity: 3,
    sheetWidthIn: 8,
    sheetHeightIn: 10,
    hourlyRate: 40,
    perPieceCost: 2,
  })!;

  const planned = run.perDesign.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(planned, 3, "the run plans exactly the order");

  const cookies = run.lines.find((line) => line.label === "Cookies")!;
  assert.equal(cookies.amount, 6, "three cookies at 2, not four");
  assert.ok(cookies.detail.startsWith("3 "), `billed for the wrong count: ${cookies.detail}`);

  // Icing for the same three pieces, whichever way it is asked.
  const direct = icingPlan(
    run.perDesign.map((entry) => ({ ...entry.design, count: entry.count })),
    0
  );
  run.icing.forEach((line, i) => assert.ok(Math.abs(line.exactCups - direct[i].exactCups) < 1e-9));
});
