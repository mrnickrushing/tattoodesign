"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { BrandConfig } from "@/lib/brands";

export default function NavBar({ brand }: { brand: BrandConfig }) {
  const pathname = usePathname();
  const base = `/${brand.id}`;
  const links = [
    { href: `${base}/generate`, label: brand.generate.navLabel },
    { href: `${base}/convert`, label: brand.convert.navLabel },
    { href: `${base}/builder`, label: brand.builder.navLabel },
  ];

  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-40 print:hidden">
      <nav className="mx-auto max-w-6xl flex items-center justify-between px-5 py-3">
        <Link href={base} className="flex items-baseline gap-2">
          <span
            className={
              brand.id === "sugar"
                ? "font-script text-3xl text-ink"
                : "font-display text-2xl tracking-wide text-ink"
            }
          >
            {brand.wordmark}
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <ul className="flex items-center gap-1 text-sm">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`px-3 py-2 rounded-full transition-colors ${
                      active
                        ? "bg-accent text-white"
                        : "text-ink/70 hover:text-ink hover:bg-ink/5"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href={`/${brand.switchTo.id}`}
            className="text-xs text-ink/40 hover:text-ink/70 border-l border-line pl-3 ml-1"
          >
            {brand.switchTo.label} →
          </Link>
        </div>
      </nav>
    </header>
  );
}
