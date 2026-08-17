"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/generate", label: "Flash Generator" },
  { href: "/convert", label: "Linework Converter" },
  { href: "/builder", label: "Sheet Builder" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-40 print:hidden">
      <nav className="mx-auto max-w-6xl flex items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-2xl tracking-wide text-ink">
            INKLINE
          </span>
          <span className="hidden sm:inline text-[11px] uppercase tracking-[0.2em] text-ink/50">
            Flash Toolkit
          </span>
        </Link>
        <ul className="flex items-center gap-1 text-sm">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`px-3 py-2 rounded-full transition-colors ${
                    active
                      ? "bg-ink text-paper"
                      : "text-ink/70 hover:text-ink hover:bg-ink/5"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
