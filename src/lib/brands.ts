// Two skins, one app. Everything that differs between "Ink Lab" (tattoo
// flash) and "Sugar Haus" (cookie / cake pop / topper design) lives here —
// copy, style-chip options, and the Gemini prompt language — so the tool
// pages themselves stay brand-agnostic.

export type BrandId = "ink" | "sugar";

export const BRAND_IDS: BrandId[] = ["ink", "sugar"];

export type GenerateStyle = {
  id: string;
  label: string;
  promptDescription: string;
  /**
   * Overrides the server's default pure-linework ink rule for this style.
   * Leave unset for stencil-style line art; set it for styles whose whole
   * point is tone (black & grey realism, dotwork stippling).
   */
  inkConstraint?: string;
};

export type HomeCard = {
  tag: string;
  title: string;
  blurb: string;
  cta: string;
  tool: "generate" | "convert" | "builder";
};

export type BrandConfig = {
  id: BrandId;
  name: string;
  /** Nav wordmark. Ink renders it in the mono display font; Sugar in script. */
  wordmark: string;
  tagline: string;
  headline: string;
  subhead: string;
  switchTo: { id: BrandId; label: string };
  home: { cards: HomeCard[] };
  generate: {
    navLabel: string;
    title: string;
    subtitle: string;
    promptPlaceholder: string;
    styles: GenerateStyle[];
    /** How the AI prompt frames the subject, e.g. "Tattoo flash design" */
    subjectFraming: string;
    /** What the linework should look like it's meant for. */
    outputFraming: string;
  };
  convert: { navLabel: string; title: string; subtitle: string };
  builder: { navLabel: string; title: string; subtitle: string };
};

/**
 * How tone is put into a piece, chosen independently of the style.
 *
 * A style says what the piece looks like; shading says how its darks are
 * built. Traditional flash can be flat, whip-shaded or packed solid and still
 * be traditional, so pairing every combination as its own style would multiply
 * the list without saying anything new.
 *
 * `render` is direction for the finished artwork. `constraint` replaces the
 * style's ink rule, because "no shading, no gray" and "whip shading" cannot
 * both be true — that contradiction is why asking for shading previously
 * produced flat line art anyway.
 */
export type ShadingVocabulary = {
  id: string;
  label: string;
  caption: string;
  render: string;
  constraint?: string;
};

export const SHADING_VOCABULARY: ShadingVocabulary[] = [
  {
    id: "none",
    label: "Line only",
    caption: "Pure outline, nothing filled — the classic transfer stencil",
    render: "",
    // Stated rather than left absent. An absent rule falls through to the
    // style's, and several styles — black & grey, chicano, dotwork — declare
    // rules that permit full tonal rendering. So picking "Line only" on one of
    // those produced a shaded illustration: the option said line only and the
    // prompt said otherwise.
    constraint:
      "Pure black ink linework only on white. No shading, no gradients, no grey, no color, no rendering, no airbrushing, no stippling, no hatching — flat outlines only.",
  },
  {
    id: "whip",
    label: "Whip",
    caption: "Tapered flicks pulled out of each shadow",
    render:
      "Build every shadow from whip shading: tapered strokes that start solid at the dark edge and flick out to nothing toward the light.",
    constraint:
      "Black ink only, all tone built from tapered whip-shading strokes, no smooth airbrushed gradients, no color.",
  },
  {
    id: "pepper",
    label: "Pepper",
    caption: "Stippled grain for soft transitions",
    render:
      "Build tone from pepper shading: loose stippled dots, dense in the shadow and thinning into the light.",
    constraint:
      "Black ink only, all tone built from stippled dots of varying density, no smooth gradients, no color.",
  },
  {
    id: "greywash",
    label: "Grey wash",
    caption: "Smooth diluted black, the black-and-grey standard",
    render:
      "Build tone from smooth grey wash: diluted black laid in soft even transitions with clean highlights left open.",
    constraint: "Black and grey ink only, smooth diluted washes, no color.",
  },
  {
    id: "hatch",
    label: "Hatching",
    caption: "Engraved crosshatch, etching sensibility",
    render:
      "Build tone from hatching and crosshatching, in the manner of an engraving, with line density carrying the value.",
    constraint:
      "Pure black ink only, all tone built from hatched and crosshatched lines, no gradients, no gray fills, no color.",
  },
  {
    id: "solid",
    label: "Solid black",
    caption: "Packed black shapes against bare skin",
    render:
      "Build tone from solid packed black: shadows fully filled, mid-tones left as bare skin, no intermediate values.",
    constraint:
      "Pure black ink only, tone built from solid filled shapes against open skin, no gradients, no gray, no color.",
  },
];

/**
 * Line weight hierarchy: the thing that separates a professional stencil from
 * an evenly-traced one. A real piece uses a heavy contour to hold the
 * silhouette, a medium line for internal structure and a light line for
 * detail, so it still reads from across the room once it has healed and
 * spread. Asked for explicitly, because a model left to its own devices draws
 * every line the same weight.
 */
export const LINE_WEIGHT_DIRECTION =
  "Use a deliberate line weight hierarchy: a heavy confident outer contour holding the silhouette, medium weight for internal structure, and the finest lines reserved for detail. Never draw every line at the same weight.";

export const BRANDS: Record<BrandId, BrandConfig> = {
  ink: {
    id: "ink",
    name: "Ink Lab",
    wordmark: "INKLINE",
    tagline: "FOR TATTOO ARTISTS & FLASH NERDS",
    headline: "Design flash. Build sheets. Print & go.",
    subhead:
      "Three tools that stay out of your way: generate flash from a prompt, turn any photo into clean stencil linework, then lay it all out on a printable flash sheet.",
    switchTo: { id: "sugar", label: "Sugar Haus" },
    home: {
      cards: [
        {
          tool: "generate",
          tag: "01",
          title: "Flash Generator",
          blurb:
            "Words or a vibe in, clean stencils on white out. Describe the piece and get tattoo-flash line art, no shading, no color, ready to trace.",
          cta: "Generate flash",
        },
        {
          tool: "convert",
          tag: "02",
          title: "Stencil Linework Converter",
          blurb:
            "Drop in a photo, get back tattoo-ready line art. Runs edge detection right in your browser and lets you dial in the line weight.",
          cta: "Convert a photo",
        },
        {
          tool: "builder",
          tag: "03",
          title: "Flash Sheet Builder",
          blurb:
            "Arrange your designs into classic sheet layouts you can print. Drag, rotate, and scale onto a real paper-sized canvas.",
          cta: "Build a sheet",
        },
      ],
    },
    generate: {
      navLabel: "Flash Generator",
      title: "Words or a vibe in, stencils out",
      subtitle:
        "Describe the piece — subject, mood, style — and generate clean black-line flash art on a white background, powered by Gemini.",
      promptPlaceholder: "e.g. a swallow wrapped around a dagger, bold traditional",
      subjectFraming: "Tattoo flash design",
      outputFraming: "suitable for a tattoo stencil, like classic flash sheet art",
      styles: [
        {
          id: "traditional",
          label: "Traditional",
          promptDescription:
            "American traditional tattoo flash style, bold uniform linework",
        },
        {
          id: "fineline",
          label: "Fine line",
          promptDescription: "fine line tattoo style, delicate single-weight linework",
        },
        {
          id: "blackwork",
          label: "Blackwork",
          promptDescription: "blackwork tattoo style, bold graphic shapes, high contrast",
        },
        {
          id: "irezumi",
          label: "Irezumi",
          promptDescription: "Japanese irezumi tattoo style, flowing linework",
        },
        {
          id: "bg-realism",
          label: "Black & grey",
          promptDescription:
            "black and grey realism tattoo style, photorealistic depth built from smooth single-needle shading",
          inkConstraint:
            "Black and grey ink only, smooth realistic shading and soft gradients, no color.",
        },
        {
          id: "neotraditional",
          label: "Neo-traditional",
          promptDescription:
            "neo-traditional tattoo style, bold outlines with varied line weight and ornate decorative flourishes",
        },
        {
          id: "chicano",
          label: "Chicano",
          promptDescription:
            "Chicano tattoo style, fine-line black and grey with smooth soft shading, script and portrait sensibility",
          inkConstraint:
            "Black and grey ink only, fine lines with smooth soft shading, no color.",
        },
        {
          id: "dotwork",
          label: "Dotwork",
          promptDescription:
            "dotwork tattoo style, every tone built from dense stippled dots",
          inkConstraint:
            "Pure black ink only, all tone and texture built from stippled dots, no smooth gradients, no gray washes, no color.",
        },
        {
          id: "geometric",
          label: "Geometric",
          promptDescription:
            "geometric tattoo style, precise symmetrical linework, sacred geometry and mandala patterning",
        },
        {
          id: "tribal",
          label: "Tribal",
          promptDescription:
            "tribal tattoo style, bold sweeping solid black shapes with strong silhouette",
        },
      ],
    },
    convert: {
      navLabel: "Linework Converter",
      title: "Photo to stencil",
      subtitle:
        "Drop in a reference photo. Everything runs locally in your browser — edge detection turns it into clean tattoo-ready line art.",
    },
    builder: {
      navLabel: "Sheet Builder",
      title: "Lay out a flash sheet",
      subtitle:
        "Drag designs onto the sheet, resize and rotate them, then print at true size.",
    },
  },

  sugar: {
    id: "sugar",
    name: "Sugar Haus",
    wordmark: "Sugar Haus",
    tagline: "FOR THE SUGAR HAUS BAKERY",
    headline: "Design sweets. Build sheets. Bake & go.",
    subhead:
      "Three tools built for cookie and cake-pop art: generate a design from a prompt, turn any photo or sketch into clean icing-ready line art, then lay it all out on a printable template sheet.",
    switchTo: { id: "ink", label: "Ink Lab" },
    home: {
      cards: [
        {
          tool: "generate",
          tag: "01",
          title: "Design Generator",
          blurb:
            "Words or a vibe in, clean templates on white out. Describe the piece and get bakery-ready line art, no shading, no color, ready to trace onto icing or cardstock.",
          cta: "Generate a design",
        },
        {
          tool: "convert",
          tag: "02",
          title: "Template Tracer",
          blurb:
            "Drop in a photo, get back bake-ready line art. Runs edge detection right in your browser and lets you dial in the line weight.",
          cta: "Convert a photo",
        },
        {
          tool: "builder",
          tag: "03",
          title: "Bake Sheet Builder",
          blurb:
            "Arrange your designs into a printable sheet you can bake by. Drag, rotate, and scale onto a real paper-sized canvas.",
          cta: "Build a sheet",
        },
      ],
    },
    generate: {
      navLabel: "Design Generator",
      title: "Words or a vibe in, templates out",
      subtitle:
        "Describe the design — subject, mood, style — and generate clean black-line cookie and cake art on a white background, powered by Gemini.",
      promptPlaceholder: "e.g. a daisy wreath cookie, simple outline for flooding",
      subjectFraming: "Cookie and cake decorating design",
      outputFraming: "suitable for a royal icing stencil or cutter template",
      styles: [
        {
          id: "cookie",
          label: "Cookie",
          promptDescription:
            "royal icing cookie decorating template, bold simple outline suitable for outline-and-flood technique",
        },
        {
          id: "cakepop",
          label: "Cake pop",
          promptDescription: "cake pop design template, simple bold silhouette shape",
        },
        {
          id: "topper",
          label: "Topper",
          promptDescription: "cake topper template, clean die-cut silhouette shape",
        },
        {
          id: "piping",
          label: "Piping detail",
          promptDescription: "delicate royal icing piping design, fine detailed linework",
        },
      ],
    },
    convert: {
      navLabel: "Template Tracer",
      title: "Photo to template",
      subtitle:
        "Drop in a reference photo or sketch. Everything runs locally in your browser — edge detection turns it into clean icing-ready line art.",
    },
    builder: {
      navLabel: "Bake Sheet Builder",
      title: "Lay out a bake sheet",
      subtitle:
        "Drag designs onto the sheet, resize and rotate them, then print at true size.",
    },
  },
};

export function isBrandId(value: string): value is BrandId {
  return value === "ink" || value === "sugar";
}

export function getBrand(id: string): BrandConfig | null {
  return isBrandId(id) ? BRANDS[id] : null;
}
