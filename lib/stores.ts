export type Store = "walmart" | "target" | "amazon" | "costco";
export const STORES: Store[] = ["walmart", "target", "amazon", "costco"];

export type Offer = {
  store: Store;
  title: string;
  price: number | null;
  priceText: string; // as shown, e.g. "$2.59 - $13.49" when the card covers several sizes
  url: string;
  sponsored: boolean;
  packCount: number;
};

export function isBarcode(q: string) {
  return /^\d{12,14}$/.test(q.replace(/[\s-]/g, ""));
}

// "Pack of 6", "(6 pack)", "6-Pack", "6/Carton". Not "16ct": that counts slices or pieces in one package.
export function packCount(text: string): number {
  const m =
    /pack of (\d+)/i.exec(text) ??
    /\b(\d+)[\s-]?(?:pack|pk)\b/i.exec(text) ??
    /\b(\d+)\s*\/\s*(?:carton|case|box)\b/i.exec(text);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 100 ? n : 1;
}

// Where each store's search page is. Sent to the extension with each comparison.
export function searchUrl(store: Store, q: string): string {
  const digits = q.replace(/[\s-]/g, "");
  const code = isBarcode(q);
  // Walmart's search only matches a barcode written as a 14-digit GTIN.
  if (store === "walmart") return `https://www.walmart.com/search?q=${encodeURIComponent(code ? digits.padStart(14, "0") : q)}`;
  if (store === "target") return `https://www.target.com/s?searchTerm=${encodeURIComponent(code ? digits : q)}`;
  if (store === "costco") return `https://www.costco.com/s?keyword=${encodeURIComponent(code ? digits : q)}`;
  return `https://www.amazon.com/s?k=${encodeURIComponent(code ? digits : q)}`;
}

// Pacing, per site: each site sees one page per comparison, at least GAP apart, at most CAP an hour.
export const PACING = { gapMs: 20_000, hourlyCap: 12, settleMs: 2500, scrolls: 2 };
