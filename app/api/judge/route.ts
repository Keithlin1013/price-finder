import { judge } from "@/lib/match";
import { isBarcode, type Offer } from "@/lib/stores";
import { primaryUnit, unitPrices } from "@/lib/units";

export async function POST(req: Request) {
  const { q, offers } = (await req.json()) as { q: string; offers: Offer[] };
  if (!offers?.length) return Response.json({ offers: [], unit: null });
  // A barcode says nothing about the product, so the first result (Walmart's exact match) describes it.
  const wanted = isBarcode(q) ? `${offers[0].title} (barcode ${q})` : q;
  try {
    const judged = (await judge(wanted, offers)).map((o) => ({ ...o, unitPrices: unitPrices(o.title, o.price, o.packCount) }));
    // Rank by price per unit (per load, per fl oz, …) so different package sizes compare fairly.
    const unit = primaryUnit(wanted, judged.filter((o) => o.same >= 0.5));
    const key = (o: (typeof judged)[number]) =>
      o.unitPrices.find((u) => u.unit === unit)?.price ?? (o.perUnit !== null ? o.perUnit + 1e6 : Infinity);
    return Response.json({ offers: judged.sort((a, b) => key(a) - key(b)), unit });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
