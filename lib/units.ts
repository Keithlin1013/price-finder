// Size parsing for per-unit prices: "170 fl oz", "152 Loads", "80 oz, 2-pack", "1.47 L", "24 ct".

export type Unit = "fl oz" | "oz" | "lb" | "load" | "count";
export type UnitPrice = { unit: Unit; price: number };

const PATTERNS: [RegExp, Unit, number][] = [
  [/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|fluid\s*ounces?)\b/i, "fl oz", 1],
  [/(\d+(?:\.\d+)?)\s*(?:ml|milliliters?)\b/i, "fl oz", 1 / 29.5735],
  [/(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?)\b/i, "fl oz", 33.814],
  [/(\d+(?:\.\d+)?)\s*(?:gal|gallons?)\b/i, "fl oz", 128],
  [/(\d+(?:\.\d+)?)\s*(?:loads?)\b/i, "load", 1],
  [/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i, "lb", 1],
  // Weight ounces; "fl oz" is matched first and removed so it is not read twice.
  [/(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/i, "oz", 1],
  [/(\d+)\s*(?:ct|count|pods|sheets|rolls|slices|pieces|pcs)\b/i, "count", 1],
];

// Quantity per unit type in one package, e.g. { "fl oz": 170, load: 152 }.
export function sizes(title: string): Partial<Record<Unit, number>> {
  let text = title;
  const out: Partial<Record<Unit, number>> = {};
  for (const [re, unit, factor] of PATTERNS) {
    const m = re.exec(text);
    if (!m || out[unit] !== undefined) continue;
    out[unit] = Number(m[1]) * factor;
    text = text.replace(m[0], " ");
  }
  return out;
}

// Price per unit for every size the title states, across all packages in a multipack.
export function unitPrices(title: string, price: number | null, packCount: number): UnitPrice[] {
  if (price === null) return [];
  return (Object.entries(sizes(title)) as [Unit, number][])
    .filter(([, qty]) => qty > 0)
    .map(([unit, qty]) => ({ unit, price: price / (qty * packCount) }));
}

// The unit to rank by: one the shopper wrote, else the one most offers state.
export function primaryUnit(query: string, offers: { unitPrices: UnitPrice[] }[]): Unit | null {
  const asked = Object.keys(sizes(query)) as Unit[];
  const counts = new Map<Unit, number>();
  for (const o of offers) for (const u of o.unitPrices) counts.set(u.unit, (counts.get(u.unit) ?? 0) + 1);
  const covered = (u: Unit) => counts.get(u) ?? 0;
  // Volume and weight first: per-ounce is how shelves compare packages of different sizes.
  const order: Unit[] = ["fl oz", "oz", "lb", "count", "load"];
  const pick = asked.filter((u) => covered(u) > 0).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  if (pick) return pick;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function formatUnitPrice(u: UnitPrice): string {
  const cents = u.price < 1;
  return cents ? `${(u.price * 100).toFixed(1)}¢/${u.unit}` : `$${u.price.toFixed(2)}/${u.unit}`;
}
