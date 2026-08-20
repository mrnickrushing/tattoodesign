// The shared design library.
//
// Three devices — a phone, an iPad, a browser — each held their own library
// and none of them knew about the others. This is the copy they all agree on.
//
// One table, because there is one kind of thing. Images live in it rather than
// in object storage: a design is about a megabyte, two people make maybe a few
// hundred, and a second storage system with its own credentials is a lot of
// moving parts for a few hundred megabytes.
//
// Deletions are rows, not absences. A design missing from a device is almost
// always one that device has not seen yet, and treating that as a deletion is
// how a sync eats a library — so a delete writes a tombstone with a timestamp
// and competes on recency like any other edit.

import { Pool } from "pg";

declare global {
  // Next reloads modules in development; without this each reload opens a new
  // pool and Postgres runs out of connections long before anything else fails.
  // eslint-disable-next-line no-var
  var __inklinePool: Pool | undefined;
}

function pool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("The library database isn't configured.");
  }
  if (!global.__inklinePool) {
    global.__inklinePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
    });
  }
  return global.__inklinePool;
}

let ready: Promise<void> | null = null;

/** Creates the table on first use, so there is no separate migration step. */
function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = pool()
      .query(
        `create table if not exists designs (
           brand       text    not null,
           id          text    not null,
           title       text    not null default '',
           source      text    not null default 'generated',
           created_at  bigint  not null,
           updated_at  bigint  not null,
           width       integer,
           height      integer,
           tags        text[]  not null default '{}',
           favorite    boolean not null default false,
           deleted     boolean not null default false,
           image_hash  text    not null default '',
           image       bytea,
           primary key (brand, id)
         )`
      )
      .then(() => undefined)
      .catch((error) => {
        // Let the next request try again rather than caching the failure for
        // the life of the process.
        ready = null;
        throw error;
      });
  }
  return ready;
}

export type DesignRow = {
  id: string;
  title: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  width: number | null;
  height: number | null;
  tags: string[];
  favorite: boolean;
  deleted: boolean;
  imageHash: string;
};

/**
 * Every design's metadata, without the images.
 *
 * Images are most of the bytes and almost none of the decisions, so the
 * manifest deliberately excludes them — a device compares timestamps and
 * hashes first, and only asks for the pixels it actually needs.
 */
export async function listDesigns(brand: string): Promise<DesignRow[]> {
  await ensureSchema();
  const result = await pool().query(
    `select id, title, source, created_at, updated_at, width, height,
            tags, favorite, deleted, image_hash
       from designs where brand = $1`,
    [brand]
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    source: row.source,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    width: row.width,
    height: row.height,
    tags: row.tags ?? [],
    favorite: row.favorite,
    deleted: row.deleted,
    imageHash: row.image_hash,
  }));
}

export async function readImage(brand: string, id: string): Promise<Buffer | null> {
  await ensureSchema();
  const result = await pool().query(`select image from designs where brand = $1 and id = $2`, [
    brand,
    id,
  ]);
  return result.rows[0]?.image ?? null;
}

export type UpsertInput = DesignRow & { imageBase64?: string | null };

/**
 * Writes a design, keeping whichever version is newer.
 *
 * The `where` clause is what makes concurrent devices safe: an update only
 * lands if it is genuinely newer than what is already stored, so two devices
 * pushing at once cannot have the older one win by arriving second.
 */
export async function upsertDesign(brand: string, input: UpsertInput): Promise<boolean> {
  await ensureSchema();
  const image = input.imageBase64 ? Buffer.from(input.imageBase64, "base64") : null;
  const result = await pool().query(
    `insert into designs
       (brand, id, title, source, created_at, updated_at, width, height,
        tags, favorite, deleted, image_hash, image)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (brand, id) do update set
       title      = excluded.title,
       source     = excluded.source,
       updated_at = excluded.updated_at,
       width      = excluded.width,
       height     = excluded.height,
       tags       = excluded.tags,
       favorite   = excluded.favorite,
       deleted    = excluded.deleted,
       image_hash = excluded.image_hash,
       -- Keep the stored image when this write did not carry one, so a rename
       -- does not blank the pixels.
       image      = coalesce(excluded.image, designs.image)
     where designs.updated_at < excluded.updated_at
     returning id`,
    [
      brand,
      input.id,
      input.title,
      input.source,
      input.createdAt,
      input.updatedAt,
      input.width,
      input.height,
      input.tags,
      input.favorite,
      input.deleted,
      input.imageHash,
      image,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}
