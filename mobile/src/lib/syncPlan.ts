// Deciding what moves between two devices.
//
// There are three libraries now — a phone, an iPad, and a browser — and until
// this existed none of them knew about the others. A design traced on the iPad
// simply did not exist on the laptop, and the only bridge was AirDrop between
// two phones.
//
// The rules are deliberately boring, because a sync that is clever about
// conflicts is a sync nobody can predict:
//
//   - Every design carries the moment it was last changed. The newer copy
//     wins. With two people who rarely edit the same design at the same
//     second, that is right almost always and understandable when it is not.
//   - Deletions are recorded, not implied by absence. A design missing from
//     one device is usually a design that device has not seen yet; treating
//     absence as deletion is how a sync eats a library.
//   - A design whose pixels never changed is never re-uploaded. Images are
//     most of the bytes and almost none of the edits — renaming a design
//     should not move a megabyte.
//
// Pure functions over two lists, so the thing that decides whether work
// survives can be tested without a network.

export type SyncRecord = {
  id: string;
  /** Last edit, in epoch milliseconds. The whole ordering rests on this. */
  updatedAt: number;
  /** Fingerprint of the image bytes; unchanged pixels are never re-sent. */
  imageHash: string;
  deleted?: boolean;
};

export type SyncAction =
  | { kind: "push"; id: string; withImage: boolean }
  | { kind: "pull"; id: string; withImage: boolean }
  | { kind: "deleteLocal"; id: string }
  | { kind: "deleteRemote"; id: string };

export type SyncPlan = {
  actions: SyncAction[];
  /** Everything that stays as it is — reported so a caller can say "3 of 40". */
  unchanged: number;
};

function index(records: SyncRecord[]): Map<string, SyncRecord> {
  const map = new Map<string, SyncRecord>();
  for (const record of records) map.set(record.id, record);
  return map;
}

/**
 * What to do to make the two sides agree.
 *
 * Note what is *not* here: no merge, no three-way anything, no prompting. For
 * two people sharing a design library, the cost of a wrong guess is one
 * overwritten title, and the cost of a confusing rule is not trusting the
 * feature at all.
 */
export function planSync(local: SyncRecord[], remote: SyncRecord[]): SyncPlan {
  const remoteById = index(remote);
  const localById = index(local);
  const actions: SyncAction[] = [];
  let unchanged = 0;

  for (const mine of local) {
    const theirs = remoteById.get(mine.id);

    if (!theirs) {
      // Never seen remotely. A local deletion with no remote row is just a
      // tombstone for something the server never had — nothing to send.
      if (mine.deleted) unchanged++;
      else actions.push({ kind: "push", id: mine.id, withImage: true });
      continue;
    }

    if (mine.updatedAt === theirs.updatedAt) {
      unchanged++;
      continue;
    }

    if (mine.updatedAt > theirs.updatedAt) {
      if (mine.deleted) actions.push({ kind: "deleteRemote", id: mine.id });
      else actions.push({ kind: "push", id: mine.id, withImage: mine.imageHash !== theirs.imageHash });
    } else {
      if (theirs.deleted) actions.push({ kind: "deleteLocal", id: mine.id });
      else actions.push({ kind: "pull", id: mine.id, withImage: mine.imageHash !== theirs.imageHash });
    }
  }

  for (const theirs of remote) {
    if (localById.has(theirs.id)) continue;
    // Absent locally. A remote tombstone for something this device never had
    // is nothing to do — not a deletion to apply to a design that is not here.
    if (theirs.deleted) unchanged++;
    else actions.push({ kind: "pull", id: theirs.id, withImage: true });
  }

  return { actions, unchanged };
}

/** A short, order-independent summary for the UI. */
export function describePlan(plan: SyncPlan): string {
  const counts = { push: 0, pull: 0, deleteLocal: 0, deleteRemote: 0 };
  for (const action of plan.actions) counts[action.kind]++;

  const parts: string[] = [];
  if (counts.push) parts.push(`${counts.push} up`);
  if (counts.pull) parts.push(`${counts.pull} down`);
  const removed = counts.deleteLocal + counts.deleteRemote;
  if (removed) parts.push(`${removed} removed`);
  if (!parts.length) return "Everything is already in sync.";
  return parts.join(" · ");
}

/**
 * Bytes that have to move, as a rough count of images.
 *
 * Metadata is negligible next to a PNG, so this is what actually predicts how
 * long a sync takes and whether it is worth doing on a phone connection.
 */
export function imagesToTransfer(plan: SyncPlan): number {
  return plan.actions.filter(
    (action) => (action.kind === "push" || action.kind === "pull") && action.withImage
  ).length;
}

/**
 * A fingerprint of image bytes.
 *
 * FNV-1a over the base64 rather than a real digest: this only ever answers
 * "are these the same bytes as last time", both sides compute it the same way,
 * and pulling in a crypto dependency to compare two local strings would be
 * machinery for its own sake. Collisions would mean a stale image; at a few
 * hundred designs that is not a risk worth a hash library.
 */
export function hashImage(dataUrl: string): string {
  const body = dataUrl.slice(dataUrl.indexOf(",") + 1);
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Length as well as the hash: cheap, and it separates the one collision
  // class that actually shows up, which is two differently-sized exports.
  return `${hash.toString(36)}-${body.length.toString(36)}`;
}
