// Batch conversion queue: many photos, one trace preset, keep the good ones.
//
// The screen owns the actual tracing; this module owns the sequencing state —
// what runs next, what failed, what's kept — as a pure reducer so the whole
// flow is testable without Skia or a picker.

export type BatchItemStatus = "pending" | "processing" | "done" | "failed";

export type BatchItem = {
  id: string;
  /** Source photo URI from the picker. */
  uri: string;
  status: BatchItemStatus;
  /** Traced result as a data URL, once done. */
  resultUrl?: string;
  /** Kept items land in the library. Done items start kept. */
  keep: boolean;
  error?: string;
};

export type BatchState = {
  items: BatchItem[];
};

export const BATCH_LIMIT = 12;

/** Seeds a queue from picked URIs, deduped, capped at BATCH_LIMIT. */
export function createBatch(uris: string[]): BatchState {
  const unique = [...new Set(uris)].slice(0, BATCH_LIMIT);
  return {
    items: unique.map((uri, index) => ({
      id: `batch-${index}`,
      uri,
      status: "pending",
      keep: false,
    })),
  };
}

/** The item the runner should process now — first pending, if nothing is running. */
export function nextPending(state: BatchState): BatchItem | null {
  if (state.items.some((item) => item.status === "processing")) return null;
  return state.items.find((item) => item.status === "pending") ?? null;
}

function update(state: BatchState, id: string, patch: Partial<BatchItem>): BatchState {
  return { items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

export function startItem(state: BatchState, id: string): BatchState {
  return update(state, id, { status: "processing", error: undefined });
}

export function completeItem(state: BatchState, id: string, resultUrl: string): BatchState {
  return update(state, id, { status: "done", resultUrl, keep: true });
}

export function failItem(state: BatchState, id: string, error: string): BatchState {
  return update(state, id, { status: "failed", error, keep: false });
}

/** Failed items re-enter the queue; anything else is left alone. */
export function retryItem(state: BatchState, id: string): BatchState {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item || item.status !== "failed") return state;
  return update(state, id, { status: "pending", error: undefined });
}

/** Keep toggles only mean something once a result exists. */
export function toggleKeep(state: BatchState, id: string): BatchState {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item || item.status !== "done") return state;
  return update(state, id, { keep: !item.keep });
}

export type BatchSummary = {
  total: number;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  kept: number;
  finished: boolean;
};

export function summarize(state: BatchState): BatchSummary {
  const count = (status: BatchItemStatus) =>
    state.items.filter((item) => item.status === status).length;
  const summary = {
    total: state.items.length,
    pending: count("pending"),
    processing: count("processing"),
    done: count("done"),
    failed: count("failed"),
    kept: state.items.filter((item) => item.status === "done" && item.keep).length,
  };
  return { ...summary, finished: summary.pending === 0 && summary.processing === 0 };
}

/** The results that should land in the library. */
export function keepers(state: BatchState): BatchItem[] {
  return state.items.filter((item) => item.status === "done" && item.keep && item.resultUrl);
}

/** Shared tag for one batch, so the whole import is one chip in the library. */
export function batchTag(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `batch-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}
