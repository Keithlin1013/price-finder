import { cachedOffers, saveOffers } from "@/lib/cache";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@/lib/parse";
import { packCount, type Offer, type Store, STORES } from "@/lib/stores";

// GET: which stores already have results for this query today.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const entries = await Promise.all(STORES.map(async (s) => [s, await cachedOffers(s, q)] as const));
  return Response.json(Object.fromEntries(entries));
}

// POST: the HTML of one store's search page, as the extension loaded it; parsed and cached here.
export async function POST(req: Request) {
  const { q, store, html } = (await req.json()) as { q: string; store: Store; html: string };
  if (!STORES.includes(store) || typeof html !== "string") return Response.json({ error: "bad request" }, { status: 400 });
  // Keep the last page per store so a parser can be fixed against it without loading the site again.
  const dir = path.join(process.cwd(), ".cache", "pages");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${store}.html`), html);
  const offers: Offer[] = parse(store, html).map((r) => ({
    store,
    title: r.title,
    priceText: r.priceText,
    price: r.priceText ? Number(r.priceText.replace(/[$,]/g, "").split("-")[0]) : null,
    url: r.url,
    sponsored: r.sponsored,
    packCount: packCount(r.title),
  }));
  await saveOffers(store, q, offers);
  return Response.json({ offers });
}
