"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  addToLibrary,
  getLibrary,
  subscribeLibrary,
  type LibraryDesign,
} from "@/lib/designLibrary";
import { fileToDataUrl } from "@/lib/stencil";
import { generateId } from "@/lib/id";
import { getBrand } from "@/lib/brands";

const PX_PER_IN = 72;

type SheetTemplate = { id: string; label: string; widthIn: number; heightIn: number };

const TEMPLATES: SheetTemplate[] = [
  { id: "letter", label: "Letter · 8.5×11", widthIn: 8.5, heightIn: 11 },
  { id: "tabloid", label: "Tabloid · 11×17", widthIn: 11, heightIn: 17 },
  { id: "a4", label: "A4 · 8.27×11.69", widthIn: 8.27, heightIn: 11.69 },
  { id: "square", label: "Square · 12×12", widthIn: 12, heightIn: 12 },
];

type SheetItem = {
  id: string;
  dataUrl: string;
  title: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  rotation: number;
};

type DragState =
  | { type: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | {
      type: "resize";
      id: string;
      startX: number;
      startY: number;
      origW: number;
      origH: number;
      rotation: number;
    }
  | { type: "rotate"; id: string; centerX: number; centerY: number };

export default function BuilderPage() {
  const { brand: brandParam } = useParams<{ brand: string }>();
  const brand = getBrand(brandParam);

  const [templateId, setTemplateId] = useState("letter");
  const [items, setItems] = useState<SheetItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Starts empty (matching the server-rendered markup, which has no access
  // to localStorage) and is filled in after hydration by the effect below.
  const [library, setLibrary] = useState<LibraryDesign[]>([]);
  const [scale, setScale] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<DragState | null>(null);

  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const sheetWidthPx = template.widthIn * PX_PER_IN;
  const sheetHeightPx = template.heightIn * PX_PER_IN;

  useEffect(() => {
    if (!brand) return;
    // Populating from localStorage, a browser-only source that stays empty
    // during SSR — this can't be a lazy useState initializer without
    // causing a hydration mismatch against the server-rendered empty state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLibrary(getLibrary(brand.id));
    return subscribeLibrary(brand.id, () => setLibrary(getLibrary(brand.id)));
  }, [brand]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setScale(Math.min(1, (w - 32) / sheetWidthPx));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheetWidthPx]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.type === "move") {
        const dxIn = (e.clientX - drag.startX) / scale / PX_PER_IN;
        const dyIn = (e.clientY - drag.startY) / scale / PX_PER_IN;
        setItems((prev) =>
          prev.map((it) =>
            it.id === drag.id
              ? { ...it, xIn: drag.origX + dxIn, yIn: drag.origY + dyIn }
              : it
          )
        );
      } else if (drag.type === "resize") {
        const dx = (e.clientX - drag.startX) / scale;
        const dy = (e.clientY - drag.startY) / scale;
        const theta = (drag.rotation * Math.PI) / 180;
        const localDx = dx * Math.cos(theta) + dy * Math.sin(theta);
        const localDy = -dx * Math.sin(theta) + dy * Math.cos(theta);
        const newWpx = Math.max(0.4 * PX_PER_IN, drag.origW * PX_PER_IN + localDx);
        const newHpx = Math.max(0.4 * PX_PER_IN, drag.origH * PX_PER_IN + localDy);
        setItems((prev) =>
          prev.map((it) =>
            it.id === drag.id
              ? { ...it, wIn: newWpx / PX_PER_IN, hIn: newHpx / PX_PER_IN }
              : it
          )
        );
      } else if (drag.type === "rotate") {
        const angle =
          (Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180) / Math.PI;
        const rotation = angle + 90;
        setItems((prev) =>
          prev.map((it) => (it.id === drag.id ? { ...it, rotation } : it))
        );
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [scale]);

  function addItem(design: { dataUrl: string; title: string }) {
    const wIn = Math.min(3, template.widthIn * 0.35);
    const id = generateId();
    const item: SheetItem = {
      id,
      dataUrl: design.dataUrl,
      title: design.title,
      xIn: template.widthIn / 2 - wIn / 2,
      yIn: template.heightIn / 2 - wIn / 2,
      wIn,
      hIn: wIn,
      rotation: 0,
    };
    setItems((prev) => [...prev, item]);
    setSelectedId(id);
  }

  function bringToFront(id: string) {
    setItems((prev) => {
      const it = prev.find((i) => i.id === id);
      if (!it) return prev;
      return [...prev.filter((i) => i.id !== id), it];
    });
  }

  function deleteSelected() {
    if (!selectedId) return;
    setItems((prev) => prev.filter((i) => i.id !== selectedId));
    setSelectedId(null);
  }

  async function handleUpload(file: File) {
    if (!brand) return;
    const dataUrl = await fileToDataUrl(file);
    addToLibrary(brand.id, { dataUrl, title: file.name, source: "uploaded" });
  }

  if (!brand) return null;

  const selected = items.find((i) => i.id === selectedId) || null;

  return (
    <main className="flex-1 bg-background">
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <p className="text-[11px] uppercase tracking-[0.3em] text-accent font-medium mb-3 print:hidden">
          03 · {brand.builder.navLabel}
        </p>
        <h1 className="font-display text-4xl sm:text-5xl tracking-wide text-ink mb-3 print:hidden">
          {brand.builder.title}
        </h1>
        <p className="text-ink/65 max-w-xl mb-8 print:hidden">{brand.builder.subtitle}</p>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px] print:block">
          <div ref={containerRef} className="print:hidden">
            <div
              style={{
                width: sheetWidthPx * scale,
                height: sheetHeightPx * scale,
              }}
            >
              <div
                onPointerDown={() => setSelectedId(null)}
                style={{
                  width: sheetWidthPx,
                  height: sheetHeightPx,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
                className="relative bg-white shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-line"
              >
                {items.map((item) => (
                  <SheetItemView
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    setRef={(el) => {
                      if (el) itemRefs.current.set(item.id, el);
                      else itemRefs.current.delete(item.id);
                    }}
                    onSelect={() => {
                      setSelectedId(item.id);
                      bringToFront(item.id);
                    }}
                    onStartMove={(e) => {
                      dragRef.current = {
                        type: "move",
                        id: item.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: item.xIn,
                        origY: item.yIn,
                      };
                    }}
                    onStartResize={(e) => {
                      dragRef.current = {
                        type: "resize",
                        id: item.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origW: item.wIn,
                        origH: item.hIn,
                        rotation: item.rotation,
                      };
                    }}
                    onStartRotate={() => {
                      const el = itemRefs.current.get(item.id);
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      dragRef.current = {
                        type: "rotate",
                        id: item.id,
                        centerX: rect.left + rect.width / 2,
                        centerY: rect.top + rect.height / 2,
                      };
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Print-only true-size sheet */}
          <div
            id="print-sheet"
            className="hidden print:block bg-white"
            style={{ width: `${template.widthIn}in`, height: `${template.heightIn}in` }}
          >
            <div className="relative w-full h-full">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="absolute"
                  style={{
                    left: `${item.xIn}in`,
                    top: `${item.yIn}in`,
                    width: `${item.wIn}in`,
                    height: `${item.hIn}in`,
                    transform: `rotate(${item.rotation}deg)`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.dataUrl} alt={item.title} className="w-full h-full object-contain" />
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-2xl border border-line bg-paper p-5 h-fit print:hidden">
            <h2 className="font-display text-xl tracking-wide text-ink mb-3">
              Sheet
            </h2>
            <div className="flex flex-wrap gap-2 mb-6">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    templateId === t.id
                      ? "bg-accent text-white"
                      : "bg-white text-ink/60 border border-line hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {selected && (
              <div className="mb-6 rounded-xl border border-line p-3">
                <p className="text-sm font-medium text-ink mb-3">
                  {selected.title}
                </p>
                <label htmlFor="sheet-item-size" className="block text-xs text-ink/60 mb-1">
                  Size ({selected.wIn.toFixed(1)}in)
                </label>
                <input
                  id="sheet-item-size"
                  type="range"
                  min={0.5}
                  max={Math.max(template.widthIn, template.heightIn)}
                  step={0.1}
                  value={selected.wIn}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    const ratio = selected.hIn / selected.wIn;
                    setItems((prev) =>
                      prev.map((it) =>
                        it.id === selected.id ? { ...it, wIn: w, hIn: w * ratio } : it
                      )
                    );
                  }}
                  className="w-full accent-accent mb-3"
                />
                <label htmlFor="sheet-item-rotation" className="block text-xs text-ink/60 mb-1">
                  Rotation ({Math.round(selected.rotation)}°)
                </label>
                <input
                  id="sheet-item-rotation"
                  type="range"
                  min={-180}
                  max={180}
                  value={selected.rotation}
                  onChange={(e) => {
                    const rotation = Number(e.target.value);
                    setItems((prev) =>
                      prev.map((it) => (it.id === selected.id ? { ...it, rotation } : it))
                    );
                  }}
                  className="w-full accent-accent mb-3"
                />
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="w-full rounded-full border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5"
                >
                  Remove from sheet
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="w-full mb-6 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white"
            >
              Print sheet
            </button>

            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-xl tracking-wide text-ink">
                Your designs
              </h2>
              <label className="cursor-pointer text-xs font-medium text-ink/60 hover:text-ink">
                Upload
                <input
                  type="file"
                  aria-label="Upload a design"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                />
              </label>
            </div>

            {library.length === 0 ? (
              <p className="text-sm text-ink/40">
                Designs from the Generator and Converter will show up here.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {library.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => addItem(d)}
                    title={d.title}
                    className="aspect-square rounded-lg border border-line bg-white overflow-hidden hover:ring-2 hover:ring-accent/40"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.dataUrl} alt={d.title} className="w-full h-full object-contain p-1" />
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function SheetItemView({
  item,
  selected,
  setRef,
  onSelect,
  onStartMove,
  onStartResize,
  onStartRotate,
}: {
  item: SheetItem;
  selected: boolean;
  setRef: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onStartMove: (e: React.PointerEvent) => void;
  onStartResize: (e: React.PointerEvent) => void;
  onStartRotate: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      ref={setRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        onStartMove(e);
      }}
      className={`absolute cursor-move select-none ${
        selected ? "outline outline-2 outline-accent" : ""
      }`}
      style={{
        left: item.xIn * PX_PER_IN,
        top: item.yIn * PX_PER_IN,
        width: item.wIn * PX_PER_IN,
        height: item.hIn * PX_PER_IN,
        transform: `rotate(${item.rotation}deg)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.dataUrl}
        alt={item.title}
        draggable={false}
        className="w-full h-full object-contain pointer-events-none"
      />
      {selected && (
        <>
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartResize(e);
            }}
            className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 rounded-full bg-accent border-2 border-white cursor-nwse-resize"
          />
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartRotate(e);
            }}
            className="absolute left-1/2 -top-6 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-accent border-2 border-white cursor-grab"
          />
        </>
      )}
    </div>
  );
}
