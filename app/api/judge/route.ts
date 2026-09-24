import { judge, type Scope } from "@/lib/match";
import { isBarcode, type Offer, packCount } from "@/lib/stores";
import { asFluid, primaryUnit, unitPrices } from "@/lib/units";

export async function POST(req: Request) {
  const { q, offers: raw, scope } = (await req.json()) as { q: string; offers: Offer[]; scope?: Scope | "auto" };
  // Pack counts are re-read from the title so cached offers pick up parser fixes.
  const offers = raw?.map((o) => ({ ...o, packCount: packCount(o.title) }));
  if (!offers?.length) return Response.json({ offers: [], unit: null, scope: "exact" });
  // A barcode says nothing about the product, so the first result (Walmart's exact match) describes it.
  const wanted = isBarcode(q) ? `${offers[0].title} (barcode ${q})` : q;
  try {
    const result = await judge(wanted, offers, scope ?? "auto", isBarcode(q));
    const judged = result.judged.map((o) => ({ ...o, unitPrices: unitPrices(o.title, o.price, o.packCount) }));
    // Rank by price per unit (per load, per fl oz, …) so different package sizes compare fairly.
    const unit = primaryUnit(wanted, judged.filter((o) => o.same >= 0.5));
    if (unit === "fl oz") for (const o of judged) o.unitPrices = asFluid(o.unitPrices);
    const key = (o: (typeof judged)[number]) =>
      o.unitPrices.find((u) => u.unit === unit)?.price ?? (o.perUnit !== null ? o.perUnit + 1e6 : Infinity);
    return Response.json({ offers: judged.sort((a, b) => key(a) - key(b)), unit, scope: result.scope });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
