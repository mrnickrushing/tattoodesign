import { strict as assert } from "node:assert";
import { test } from "node:test";
import { imageDataUrl, sniffImageType } from "./imageType";

// Real magic numbers, base64-encoded.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQ";
const WEBP = "UklGRiIAAABXRUJQVlA4";
const GIF = "R0lGODlhAQABAIAAAP";

test("each format is recognised from its own bytes", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(WEBP), "image/webp");
  assert.equal(sniffImageType(GIF), "image/gif");
});

test("a png announced as a jpeg is labelled png", () => {
  // The bug this exists for: every picker in the app used to say jpeg, and a
  // browser will not decode a png that claims to be one.
  assert.match(imageDataUrl(PNG, "image/jpeg"), /^data:image\/png;base64,/);
});

test("a correct declaration is kept", () => {
  assert.match(imageDataUrl(JPEG, "image/jpeg"), /^data:image\/jpeg;base64,/);
});

test("a missing declaration falls back to the bytes", () => {
  assert.match(imageDataUrl(WEBP), /^data:image\/webp;base64,/);
  assert.match(imageDataUrl(PNG, null), /^data:image\/png;base64,/);
});

test("the payload is passed through untouched", () => {
  assert.ok(imageDataUrl(PNG).endsWith(PNG));
});

test("something unrecognised is still given a usable type", () => {
  assert.match(imageDataUrl("Zm9vYmFy"), /^data:image\/[a-z]+;base64,/);
});
