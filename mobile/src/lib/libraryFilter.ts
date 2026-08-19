// Finding a design once the library stops fitting on one screen.
//
// Pure functions over LibraryDesign metadata — no storage, no Skia — so the
// search behaviour is fully unit-testable. The builder screen owns the state;
// this module owns what "matches" means.

import type { LibraryDesign } from "./designLibrary";

export type SourceFilter = "all" | LibraryDesign["source"];

export type LibraryQuery = {
  /** Free text matched against title and tags, case-insensitively. */
  query?: string;
  source?: SourceFilter;
  favoritesOnly?: boolean;
  /** Exact tag (already normalized) that must be present. */
  tag?: string;
};

/**
 * Turns comma-separated user input into stored tags: trimmed, lowercased,
 * deduplicated, empties dropped. "Jake,  SLEEVE , jake," → ["jake", "sleeve"].
 */
export function normalizeTags(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Every tag in use, most-used first, ties alphabetical. */
export function allTags(designs: LibraryDesign[]): string[] {
  const counts = new Map<string, number>();
  for (const design of designs) {
    for (const tag of design.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

function matchesQuery(design: LibraryDesign, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (design.title.toLowerCase().includes(needle)) return true;
  return (design.tags ?? []).some((tag) => tag.includes(needle));
}

/**
 * Applies the query and returns matches with favorites first; within each
 * group the caller's order (newest-first from storage) is preserved.
 */
export function filterDesigns(
  designs: LibraryDesign[],
  filters: LibraryQuery
): LibraryDesign[] {
  const matched = designs.filter((design) => {
    if (filters.source && filters.source !== "all" && design.source !== filters.source) return false;
    if (filters.favoritesOnly && !design.favorite) return false;
    if (filters.tag && !(design.tags ?? []).includes(filters.tag)) return false;
    if (filters.query && !matchesQuery(design, filters.query)) return false;
    return true;
  });
  // Stable partition, not a sort: relative order within each half survives.
  return [...matched.filter((d) => d.favorite), ...matched.filter((d) => !d.favorite)];
}

/** True when any filter is narrowing the library — drives "no matches" copy. */
export function isFiltering(filters: LibraryQuery): boolean {
  return Boolean(
    (filters.query && filters.query.trim()) ||
      (filters.source && filters.source !== "all") ||
      filters.favoritesOnly ||
      filters.tag
  );
}
