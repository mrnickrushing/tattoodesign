// The sync endpoint.
//
// GET  ?brand=ink                 -> every design's metadata, no images
// GET  ?brand=ink&id=x&image=1    -> one design's PNG
// POST { brand, design }          -> write one design, newest wins
//
// Guarded by a shared token rather than accounts. Two people share this
// library; a login system would be more machinery than the thing it protects.
// The token is not baked into the app — each device is given it once and keeps
// it locally, so it is never sitting in a bundle anyone can read.

import { NextRequest, NextResponse } from "next/server";
import { listDesigns, readImage, upsertDesign, type DesignRow } from "@/lib/library";

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
    if (url.hostname.endsWith(".up.railway.app")) return origin;
    if (url.hostname.endsWith(".expo.app")) return origin;
    if (url.hostname === "rushingtechnologies.com" || url.hostname.endsWith(".rushingtechnologies.com")) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function withCors(response: Response, origin: string | null): Response {
  const allowed = allowedOrigin(origin);
  if (allowed) {
    response.headers.set("Access-Control-Allow-Origin", allowed);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

/**
 * Constant-time-ish comparison. Not a meaningful defence on its own, but
 * comparing secrets with === leaks their length and prefix through timing for
 * free, and not doing that costs nothing.
 */
function tokenMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return !!given && tokenMatches(given, expected);
}

const BRANDS = new Set(["ink", "sugar"]);

export async function OPTIONS(req: NextRequest) {
  const response = new Response(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Max-Age", "86400");
  return withCors(response, req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!authorized(req)) {
    return withCors(NextResponse.json({ error: "Not authorized." }, { status: 401 }), origin);
  }

  const url = new URL(req.url);
  const brand = url.searchParams.get("brand") ?? "";
  if (!BRANDS.has(brand)) {
    return withCors(NextResponse.json({ error: "Unknown studio." }, { status: 400 }), origin);
  }

  const id = url.searchParams.get("id");
  if (id && url.searchParams.get("image")) {
    try {
      const image = await readImage(brand, id);
      if (!image) {
        return withCors(NextResponse.json({ error: "No such design." }, { status: 404 }), origin);
      }
      const response = new Response(new Uint8Array(image), {
        headers: {
          "Content-Type": "image/png",
          // Content-addressed by the caller's own hash check, so once fetched
          // it never needs revalidating.
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
      return withCors(response, origin);
    } catch (error) {
      console.error("[library] image read failed", error);
      return withCors(NextResponse.json({ error: "Couldn't read that design." }, { status: 500 }), origin);
    }
  }

  try {
    return withCors(NextResponse.json({ designs: await listDesigns(brand) }), origin);
  } catch (error) {
    console.error("[library] list failed", error);
    return withCors(
      NextResponse.json({ error: "The shared library isn't reachable." }, { status: 503 }),
      origin
    );
  }
}

/** Largest design accepted, as base64. Roughly a 6MB PNG. */
const MAX_IMAGE_BASE64 = 8_000_000;

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!authorized(req)) {
    return withCors(NextResponse.json({ error: "Not authorized." }, { status: 401 }), origin);
  }

  let body: { brand?: string; design?: Partial<DesignRow> & { imageBase64?: string } };
  try {
    body = await req.json();
  } catch {
    return withCors(NextResponse.json({ error: "Invalid request body." }, { status: 400 }), origin);
  }

  const brand = body.brand ?? "";
  const design = body.design;
  if (!BRANDS.has(brand) || !design?.id || typeof design.updatedAt !== "number") {
    return withCors(NextResponse.json({ error: "Incomplete design." }, { status: 400 }), origin);
  }
  if (design.imageBase64 && design.imageBase64.length > MAX_IMAGE_BASE64) {
    return withCors(NextResponse.json({ error: "That design is too large to sync." }, { status: 413 }), origin);
  }

  try {
    const written = await upsertDesign(brand, {
      id: design.id,
      title: design.title ?? "",
      source: design.source ?? "generated",
      createdAt: design.createdAt ?? design.updatedAt,
      updatedAt: design.updatedAt,
      width: design.width ?? null,
      height: design.height ?? null,
      tags: design.tags ?? [],
      favorite: design.favorite ?? false,
      deleted: design.deleted ?? false,
      imageHash: design.imageHash ?? "",
      imageBase64: design.imageBase64 ?? null,
    });
    // `written: false` is not a failure — it means the server already held a
    // newer copy, which the caller needs to know so it can pull instead.
    return withCors(NextResponse.json({ written }), origin);
  } catch (error) {
    console.error("[library] write failed", error);
    return withCors(
      NextResponse.json({ error: "The shared library isn't reachable." }, { status: 503 }),
      origin
    );
  }
}
