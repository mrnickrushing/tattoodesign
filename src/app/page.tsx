import Link from "next/link";

const tools = [
  {
    href: "/generate",
    tag: "01",
    title: "Flash Generator",
    blurb:
      "Words or a vibe in, clean stencils on white out. Describe the piece and get tattoo-flash line art, no shading, no color, ready to trace.",
    cta: "Generate flash",
  },
  {
    href: "/convert",
    tag: "02",
    title: "Stencil Linework Converter",
    blurb:
      "Drop in a photo, get back tattoo-ready line art. Runs edge detection right in your browser and lets you dial in the line weight.",
    cta: "Convert a photo",
  },
  {
    href: "/builder",
    tag: "03",
    title: "Flash Sheet Builder",
    blurb:
      "Arrange your designs into classic sheet layouts you can print. Drag, rotate, and scale onto a real paper-sized canvas.",
    cta: "Build a sheet",
  },
];

export default function Home() {
  return (
    <main className="flex-1 bg-background">
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 sm:pt-24 sm:pb-14">
        <p className="text-[11px] uppercase tracking-[0.3em] text-accent font-medium mb-4">
          For tattoo artists &amp; flash nerds
        </p>
        <h1 className="font-display text-5xl sm:text-7xl leading-[0.95] tracking-wide text-ink max-w-3xl">
          Design flash. Build sheets. Print &amp; go.
        </h1>
        <p className="mt-6 max-w-xl text-base sm:text-lg text-ink/70 leading-relaxed">
          Three tools that stay out of your way: generate flash from a
          prompt, turn any photo into clean stencil linework, then lay it all
          out on a printable flash sheet.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24 grid gap-5 sm:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex flex-col justify-between rounded-2xl border border-line bg-paper p-6 min-h-64 transition-shadow hover:shadow-[0_8px_30px_rgba(15,14,12,0.08)]"
          >
            <div>
              <span className="font-display text-4xl text-ink/15 group-hover:text-accent/30 transition-colors">
                {tool.tag}
              </span>
              <h2 className="mt-3 font-display text-2xl tracking-wide text-ink">
                {tool.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">
                {tool.blurb}
              </p>
            </div>
            <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink group-hover:text-accent transition-colors">
              {tool.cta}
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
