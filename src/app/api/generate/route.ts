import { NextRequest, NextResponse } from "next/server";
import { getBrand } from "@/lib/brands";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const MAX_PROMPT_LENGTH = 500;

const PROVIDERS = ["gemini", "openai", "claude"] as const;
type ImageProvider = (typeof PROVIDERS)[number];

function isProvider(value: unknown): value is ImageProvider {
  return typeof value === "string" && PROVIDERS.includes(value as ImageProvider);
}

function missingConfiguration(provider: ImageProvider): string | null {
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    return "Gemini isn't connected yet. Set GEMINI_API_KEY to enable it.";
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    return "OpenAI Image isn't connected yet. Set OPENAI_API_KEY to enable it.";
  }
  if (provider === "claude") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return "Claude art direction isn't connected yet. Set ANTHROPIC_API_KEY to enable it.";
    }
    if (!process.env.GEMINI_API_KEY) {
      return "Claude directs the concept and Gemini renders it, so GEMINI_API_KEY is also required.";
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: { prompt?: string; style?: string; brand?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.provider !== undefined && !isProvider(body.provider)) {
    return NextResponse.json({ error: "Choose a supported image provider." }, { status: 400 });
  }
  const provider: ImageProvider = body.provider || "gemini";
  const configurationError = missingConfiguration(provider);
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 501 });
  }

  const brand = getBrand(body.brand || "ink") || getBrand("ink")!;
  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Describe what you want first." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Keep it under ${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 }
    );
  }

  // This endpoint is unauthenticated and calls paid APIs, so every configured
  // provider shares the same abuse guard.
  const rateLimit = checkRateLimit(getClientKey(req));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a bit." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const style =
    brand.generate.styles.find((candidate) => candidate.id === body.style) ||
    brand.generate.styles[0];
  const fullPrompt = [
    `${brand.generate.subjectFraming}: ${prompt}.`,
    style.promptDescription + ".",
    "Pure black ink linework only, no shading, no color, no gradients, no gray.",
    "Isolated on a solid pure white background, centered composition.",
    `Clean unbroken outlines ${brand.generate.outputFraming}.`,
  ].join(" ");

  try {
    if (provider === "openai") return await generateWithOpenAI(fullPrompt);
    if (provider === "claude") {
      const directedPrompt = await directWithClaude(fullPrompt);
      return await generateWithGemini(directedPrompt, "Claude-directed Gemini");
    }
    return await generateWithGemini(fullPrompt, "Gemini");
  } catch (error) {
    console.error(`${provider} generation request failed`, error);
    return NextResponse.json(
      { error: "Couldn't reach the selected AI. Try again in a moment." },
      { status: 502 }
    );
  }
}

async function generateWithGemini(prompt: string, label: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`${label} API error`, res.status, text);
    if (res.status === 429) {
      return NextResponse.json(
        {
          error: text.includes("limit: 0")
            ? `The Gemini plan doesn't include image generation on "${GEMINI_MODEL}".`
            : "Hit the Gemini rate limit. Wait a moment and try again.",
        },
        { status: 429 }
      );
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Gemini rejected its API key." }, { status: 502 });
    }
    if (res.status === 404) {
      return NextResponse.json(
        { error: `Gemini model "${GEMINI_MODEL}" wasn't found.` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: `${label} couldn't generate that. Try a different prompt.` },
      { status: 502 }
    );
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find(
    (part: { inlineData?: { data?: string } }) => part.inlineData?.data
  );
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
}

async function generateWithOpenAI(prompt: string) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size: "1024x1024",
      quality: "medium",
      output_format: "png",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("OpenAI Image API error", res.status, text);
    if (res.status === 429) {
      return NextResponse.json(
        { error: "Hit the OpenAI Image rate limit. Wait a moment and try again." },
        { status: 429 }
      );
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "OpenAI rejected its API key." }, { status: 502 });
    }
    if (res.status === 404) {
      return NextResponse.json(
        { error: `OpenAI image model "${OPENAI_IMAGE_MODEL}" wasn't found.` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "OpenAI Image couldn't generate that. Try a different prompt." },
      { status: 502 }
    );
  }

  const data = await res.json();
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) {
    return NextResponse.json(
      { error: "No image came back. Try rephrasing your prompt." },
      { status: 502 }
    );
  }
  return NextResponse.json({ imageBase64, mimeType: "image/png" });
}

async function directWithClaude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system:
        "You are an expert tattoo and bakery line-art director. Return only a refined image-generation prompt. Preserve every production constraint and never add commentary.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Claude API error", res.status, text);
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Claude rejected its API key."
        : `Claude art direction failed with status ${res.status}.`
    );
  }
  const data = await res.json();
  const directed = data?.content?.find(
    (part: { type?: string; text?: string }) => part.type === "text"
  )?.text;
  if (!directed?.trim()) throw new Error("Claude returned no art direction.");
  return directed.trim();
}
