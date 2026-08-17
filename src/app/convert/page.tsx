"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_STENCIL_OPTIONS,
  downloadDataUrl,
  fileToDataUrl,
  stencilize,
  type StencilOptions,
} from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";

export default function ConvertPage() {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [opts, setOpts] = useState<StencilOptions>(DEFAULT_STENCIL_OPTIONS);
  const dropRef = useRef<HTMLDivElement>(null);

  const runPipeline = useCallback(
    async (src: string, options: StencilOptions) => {
      setProcessing(true);
      setError(null);
      try {
        const { dataUrl } = await stencilize(src, options);
        setResultUrl(dataUrl);
      } catch {
        setError("Couldn't process that image. Try a different file.");
      } finally {
        setProcessing(false);
      }
    },
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please drop an image file.");
        return;
      }
      setSaved(false);
      const dataUrl = await fileToDataUrl(file);
      setSourceUrl(dataUrl);
      runPipeline(dataUrl, opts);
    },
    [opts, runPipeline]
  );

  const updateOpts = useCallback(
    (patch: Partial<StencilOptions>) => {
      const next = { ...opts, ...patch };
      setOpts(next);
      if (sourceUrl) runPipeline(sourceUrl, next);
    },
    [opts, sourceUrl, runPipeline]
  );

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = (e: DragEvent) => {
      prevent(e);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    };
    el.addEventListener("dragover", prevent);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", prevent);
      el.removeEventListener("drop", onDrop);
    };
  }, [handleFile]);

  return (
    <main className="flex-1 bg-background">
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <p className="text-[11px] uppercase tracking-[0.3em] text-accent font-medium mb-3">
          02 · Linework Converter
        </p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-wide text-ink mb-3">
          Photo to stencil
        </h1>
        <p className="text-ink/65 max-w-xl mb-10">
          Drop in a reference photo. Everything runs locally in your browser
          — edge detection turns it into clean tattoo-ready line art.
        </p>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-5 sm:grid-cols-2">
            <div
              ref={dropRef}
              className="relative aspect-square rounded-2xl border-2 border-dashed border-line bg-paper flex flex-col items-center justify-center overflow-hidden"
            >
              {sourceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sourceUrl}
                  alt="Source"
                  className="absolute inset-0 h-full w-full object-contain p-2"
                />
              ) : (
                <div className="text-center px-6">
                  <p className="text-ink/60 text-sm mb-3">
                    Drag a photo here, or
                  </p>
                  <label className="inline-flex cursor-pointer items-center rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90">
                    Choose file
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(file);
                      }}
                    />
                  </label>
                </div>
              )}
              <span className="absolute top-3 left-3 text-[10px] uppercase tracking-widest text-ink/40 bg-paper/80 px-2 py-1 rounded-full">
                Source
              </span>
            </div>

            <div className="relative aspect-square rounded-2xl border border-line bg-white flex items-center justify-center overflow-hidden">
              {resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resultUrl}
                  alt="Stencil result"
                  className="absolute inset-0 h-full w-full object-contain p-2"
                />
              ) : (
                <p className="text-ink/30 text-sm px-6 text-center">
                  {processing ? "Processing…" : "Your stencil will appear here"}
                </p>
              )}
              {processing && (
                <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-sm text-ink/60">
                  Processing…
                </div>
              )}
              <span className="absolute top-3 left-3 text-[10px] uppercase tracking-widest text-ink/40 bg-white/80 px-2 py-1 rounded-full">
                Stencil
              </span>
            </div>
          </div>

          <aside className="rounded-2xl border border-line bg-paper p-5 h-fit">
            <h2 className="font-display text-xl tracking-wide text-ink mb-4">
              Controls
            </h2>
            <div className="space-y-5 text-sm">
              <Slider
                label="Sensitivity"
                hint="Lower = more detail picked up as lines"
                min={10}
                max={180}
                value={opts.threshold ?? 60}
                onChange={(v) => updateOpts({ threshold: v })}
              />
              <Slider
                label="Line weight"
                min={0}
                max={4}
                value={opts.lineWeight ?? 1}
                onChange={(v) => updateOpts({ lineWeight: v })}
              />
              <Slider
                label="Denoise"
                min={0}
                max={4}
                value={opts.denoise ?? 1}
                onChange={(v) => updateOpts({ denoise: v })}
              />
              <label className="flex items-center justify-between">
                <span className="text-ink/70">Invert</span>
                <input
                  type="checkbox"
                  checked={!!opts.invert}
                  onChange={(e) =>
                    updateOpts({ invert: e.target.checked })
                  }
                />
              </label>
            </div>

            {error && (
              <p className="mt-4 text-sm text-accent">{error}</p>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={!resultUrl}
                onClick={() => resultUrl && downloadDataUrl(resultUrl, "stencil.png")}
                className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper disabled:opacity-30"
              >
                Download PNG
              </button>
              <button
                type="button"
                disabled={!resultUrl}
                onClick={() => {
                  if (!resultUrl) return;
                  addToLibrary({
                    dataUrl: resultUrl,
                    title: "Converted stencil",
                    source: "converted",
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

function Slider({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-ink/70">{label}</span>
        <span className="text-ink/40 text-xs">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      {hint && <p className="text-[11px] text-ink/40 mt-1">{hint}</p>}
    </div>
  );
}
