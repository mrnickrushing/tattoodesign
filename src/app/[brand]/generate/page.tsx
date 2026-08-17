"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { downloadDataUrl, stencilize } from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";
import { getBrand } from "@/lib/brands";

export default function GeneratePage() {
  const { brand: brandParam } = useParams<{ brand: string }>();
  const brand = getBrand(brandParam);

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState(brand?.generate.styles[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [stencilUrl, setStencilUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);

  useEffect(() => {
    // Surface the "not connected" state on load without requiring a submit,
    // so the UI is honest about capability before the user types anything.
    const controller = new AbortController();
    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand: brandParam }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 501) {
          const data = await res.json();
          setDisabledReason(data.error);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [brandParam]);

  if (!brand) return null;

  async function handleGenerate() {
    if (!brand || !prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setDisabledReason(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style, brand: brand.id }),
      });
      const data = await res.json();

      if (res.status === 501) {
        setDisabledReason(data.error);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
      setRawUrl(dataUrl);
      const { dataUrl: stencilDataUrl } = await stencilize(dataUrl, {
        threshold: 70,
        lineWeight: 1,
        denoise: 1,
      });
      setStencilUrl(stencilDataUrl);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex-1 bg-background">
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <p className="text-[11px] uppercase tracking-[0.3em] text-accent font-medium mb-3">
          01 · {brand.generate.navLabel}
        </p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-wide text-ink mb-3">
          {brand.generate.title}
        </h1>
        <p className="text-ink/65 max-w-xl mb-8">{brand.generate.subtitle}</p>

        {disabledReason && (
          <div className="mb-8 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent">
            {disabledReason}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-5 sm:grid-cols-2">
            <ImagePane label="Raw generation" src={rawUrl} loading={loading} placeholder="AI output will appear here" />
            <ImagePane label="Stencil" src={stencilUrl} loading={loading} placeholder="Cleaned line art will appear here" />
          </div>

          <aside className="rounded-2xl border border-line bg-paper p-5 h-fit">
            <h2 id="generate-prompt-label" className="font-display text-xl tracking-wide text-ink mb-4">
              Prompt
            </h2>
            <textarea
              id="generate-prompt"
              aria-labelledby="generate-prompt-label"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={brand.generate.promptPlaceholder}
              rows={4}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />

            <div className="mt-4">
              <p className="text-sm text-ink/70 mb-2">Style</p>
              <div className="flex flex-wrap gap-2">
                {brand.generate.styles.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      style === s.id
                        ? "bg-accent text-white"
                        : "bg-white text-ink/60 border border-line hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-accent">{error}</p>}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading || !!disabledReason}
              className="mt-6 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-30"
            >
              {loading ? "Generating…" : "Generate"}
            </button>

            <div className="mt-2 flex flex-col gap-2">
              <button
                type="button"
                disabled={!stencilUrl}
                onClick={() => stencilUrl && downloadDataUrl(stencilUrl, "design.png")}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-30"
              >
                Download PNG
              </button>
              <button
                type="button"
                disabled={!stencilUrl}
                onClick={() => {
                  if (!stencilUrl) return;
                  addToLibrary(brand.id, {
                    dataUrl: stencilUrl,
                    title: prompt.slice(0, 40) || "Generated design",
                    source: "generated",
                  });
                  setSaved(true);
                }}
                className="rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink disabled:opacity-30"
              >
                {saved ? "Added to Sheet Builder ✓" : "Send to Sheet Builder"}
              </button>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function ImagePane({
  label,
  src,
  loading,
  placeholder,
}: {
  label: string;
  src: string | null;
  loading: boolean;
  placeholder: string;
}) {
  return (
    <div className="relative aspect-square rounded-2xl border border-line bg-white flex items-center justify-center overflow-hidden">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="absolute inset-0 h-full w-full object-contain p-2" />
      ) : (
        <p className="text-ink/30 text-sm px-6 text-center">
          {loading ? "Generating…" : placeholder}
        </p>
      )}
      {loading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-sm text-ink/60">
          Generating…
        </div>
      )}
      <span className="absolute top-3 left-3 text-[10px] uppercase tracking-widest text-ink/40 bg-white/80 px-2 py-1 rounded-full">
        {label}
      </span>
    </div>
  );
}
