import Link from "next/link";
import { BRANDS } from "@/lib/brands";

const doors = [
  {
    brand: BRANDS.ink,
    tagline: "Tattoo flash & stencils",
    blurb:
      "Generate flash from a prompt, convert photos into stencil linework, and build printable flash sheets.",
  },
  {
    brand: BRANDS.sugar,
    tagline: "Cookie, cake pop & topper design",
    blurb:
      "Generate cookie and cake designs from a prompt, convert photos into icing-ready line art, and build printable bake sheets.",
  },
];

export default function Home() {
  return (
    <main className="flex-1 flex flex-col bg-background">
      <section className="mx-auto max-w-4xl w-full px-5 pt-20 pb-10 text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-accent font-medium mb-4">
          One toolkit, two studios
        </p>
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-wide text-ink">
          Pick your studio
        </h1>
        <p className="mt-5 text-base sm:text-lg text-ink/60 max-w-xl mx-auto">
          Same three tools underneath — generate, convert, and build printable
          sheets — themed for whoever&apos;s using them.
        </p>
      </section>

      <section className="mx-auto max-w-4xl w-full px-5 pb-24 grid gap-6 sm:grid-cols-2">
        {doors.map(({ brand, tagline, blurb }) => (
          <div key={brand.id} data-brand={brand.id}>
            <Link
              href={`/${brand.id}`}
              className="group flex flex-col justify-between rounded-2xl border border-line bg-paper text-ink p-8 min-h-72 transition-shadow hover:shadow-lg"
            >
              <div>
                <p className="text-[11px] uppercase tracking-[0.25em] font-medium mb-3 text-accent">
                  {tagline}
                </p>
                <h2 className="font-display text-4xl tracking-wide">{brand.name}</h2>
                <p className="mt-4 text-sm leading-relaxed text-ink/70">{blurb}</p>
              </div>
              <span className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                Enter {brand.name}
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </Link>
          </div>
        ))}
      </section>
    </main>
  );
}
