import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NavBar from "@/components/NavBar";
import { BRAND_IDS, getBrand } from "@/lib/brands";

export function generateStaticParams() {
  return BRAND_IDS.map((brand) => ({ brand }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string }>;
}): Promise<Metadata> {
  const { brand: brandParam } = await params;
  const brand = getBrand(brandParam);
  if (!brand) return {};
  return {
    title: `${brand.name} — ${brand.wordmark}`,
    description: brand.subhead,
  };
}

export default async function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brand: string }>;
}) {
  const { brand: brandParam } = await params;
  const brand = getBrand(brandParam);
  if (!brand) notFound();

  return (
    // Keyed on the brand so switching studios remounts the subtree instead
    // of leaving stale per-brand client state (library, form inputs) behind.
    <div
      key={brand.id}
      data-brand={brand.id}
      className="flex-1 flex flex-col bg-background text-foreground"
    >
      <NavBar brand={brand} />
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}
