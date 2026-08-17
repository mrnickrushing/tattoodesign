import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrand } from "@/lib/brands";

export default async function BrandHome({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand: brandParam } = await params;
  const brand = getBrand(brandParam);
  if (!brand) notFound();

  return (
    <main className="flex-1 bg-background">
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 sm:pt-24 sm:pb-14">
        <p className="text-[11px] uppercase tracking-[0.3em] text-accent font-medium mb-4">
          {brand.tagline}
        </p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-wide text-ink max-w-3xl">
          {brand.headline}
        </h1>
        <p className="mt-6 max-w-xl text-base sm:text-lg text-ink/70 leading-relaxed">
          {brand.subhead}
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24 grid gap-5 sm:grid-cols-3">
        {brand.home.cards.map((card) => (
          <Link
            key={card.tool}
            href={`/${brand.id}/${card.tool}`}
            className="group flex flex-col justify-between rounded-2xl border border-line bg-paper p-6 min-h-64 transition-shadow hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
          >
            <div>
              <span className="font-display text-4xl text-ink/15 group-hover:text-accent/40 transition-colors">
                {card.tag}
              </span>
              <h2 className="mt-3 font-display text-2xl tracking-wide text-ink">
                {card.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{card.blurb}</p>
            </div>
            <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink group-hover:text-accent transition-colors">
              {card.cta}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
