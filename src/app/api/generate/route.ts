import { NextRequest, NextResponse } from "next/server";
import { getBrand } from "@/lib/brands";

export const runtime = "nodejs";

const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "The generator isn't connected yet. Set GEMINI_API_KEY in your environment to enable AI generation.",
      },
      { status: 501 }
    );
  }

  let body: { prompt?: string; style?: string; brand?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const brand = getBrand(body.brand || "ink") || getBrand("ink")!;
  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Describe what you want first." }, { status: 400 });
  }

  const style =
    brand.generate.styles.find((s) => s.id === body.style) || brand.generate.styles[0];

  const fullPrompt = [
    `${brand.generate.subjectFraming}: ${prompt}.`,
    style.promptDescription + ".",
    "Pure black ink linework only, no shading, no color, no gradients, no gray.",
    "Isolated on a solid pure white background, centered composition.",
    `Clean unbroken outlines ${brand.generate.outputFraming}.`,
  ].join(" ");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("Gemini API error", res.status, text);
      return NextResponse.json(
        { error: "The AI model couldn't generate that. Try a different prompt." },
        { status: 502 }
      );
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);

    if (!imagePart) {
      return NextResponse.json(
        { error: "No image came back. Try rephrasing your prompt." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png",
    });
  } catch (err) {
    console.error("Gemini request failed", err);
    return NextResponse.json(
      { error: "Couldn't reach the AI model. Try again in a moment." },
      { status: 502 }
    );
  }
}
