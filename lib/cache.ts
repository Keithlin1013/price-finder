import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Offer, Store } from "./stores";

const CACHE_DIR = path.join(process.cwd(), ".cache");
// A repeat lookup within a day reuses the last result instead of loading the store page again.
const CACHE_MS = 24 * 60 * 60 * 1000;

function file(store: Store, q: string) {
  const id = createHash("sha1").update(q.trim().toLowerCase()).digest("hex").slice(0, 16);
  return path.join(CACHE_DIR, `offers-${store}-${id}.json`);
}

export async function cachedOffers(store: Store, q: string): Promise<Offer[] | null> {
  try {
    const hit = JSON.parse(await readFile(file(store, q), "utf8"));
    return Date.now() - hit.at < CACHE_MS ? hit.offers : null;
  } catch {
    return null;
  }
}

export async function saveOffers(store: Store, q: string, offers: Offer[]) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file(store, q), JSON.stringify({ at: Date.now(), offers }));
}
