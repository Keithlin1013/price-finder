import * as cheerio from "cheerio";
import type { Store } from "./stores";

// Parses a store's search-results page. It runs on the server from the HTML the extension sends,
// so a site change is fixed here without reloading the extension.

export type Raw = { title: string; priceText: string; url: string; sponsored: boolean };

type $ = cheerio.CheerioAPI;
type El = cheerio.Cheerio<any>;

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const BADGE = /^\$|GiftCard|gift card|Rarely returned|Highly rated|Sponsored|Bestseller|New at|out of 5 stars|ratings?$|^\(\d/i;

function abs(base: string, href: string | undefined) {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

// Text of the leaf elements under `el`, one entry per visual line.
function lines($: $, el: El): string[] {
  return el
    .find("*")
    .filter((_, n) => $(n).children().length === 0)
    .map((_, n) => clean($(n).text()))
    .get()
    .filter(Boolean);
}

function walmart($: $): Raw[] {
  // The page embeds its results as JSON, with the price already split out: more reliable than
  // reading the price from rendered text (some cards render it as "$44" + "99").
  try {
    const data = JSON.parse($("#__NEXT_DATA__").text());
    const stacks = data?.props?.pageProps?.initialData?.searchResult?.itemStacks ?? [];
    const items = stacks.flatMap((s: any) => s.items ?? []).filter((i: any) => i?.name && (i.canonicalUrl || i.usItemId));
    if (items.length) {
      return items.map((i: any) => ({
        title: clean(i.name),
        priceText: i.priceInfo?.linePrice || i.priceInfo?.itemPrice || (i.price ? `$${Number(i.price).toFixed(2)}` : ""),
        url: abs("https://www.walmart.com", i.canonicalUrl || `/ip/${i.usItemId}`).split("?")[0],
        sponsored: !!(i.isSponsoredFlag || i.sponsoredProduct),
      }));
    }
  } catch {}
  return $("[data-item-id]")
    .map((_, e) => {
      const card = $(e);
      const text = clean(card.text());
      const a = card.find('a[href*="/ip/"]').first();
      return {
        title: clean(card.find('[data-automation-id="product-title"]').first().text()) || clean(a.text()),
        priceText: /current price (?:Now )?(\$[\d,.]+)/.exec(text)?.[1] || /\$\d+\.\d{2}/.exec(text)?.[0] || "",
        url: abs("https://www.walmart.com", a.attr("href")).split("?")[0],
        sponsored: /\bSponsored\b/.test(text),
      };
    })
    .get();
}

function target($: $): Raw[] {
  return $('a[href*="/-/A-"]')
    .filter((_, a) => clean($(a).text()).length > 10)
    .map((_, a) => {
      // Price and rating sit in sibling nodes, so climb to the card that holds them.
      let card = $(a);
      for (let i = 0; i < 6; i++) {
        const p = card.parent();
        if (!p.length || p.find('a[href*="/-/A-"]').length > 3 || clean(p.text()).length > 600) break;
        card = p;
      }
      const text = clean(card.text());
      // The link also wraps promo badges ("$5 Target GiftCard with…", "Rarely returned");
      // the product name is the longest line that is not one of those.
      const title =
        clean(card.find('[data-test="product-title"]').first().text()) ||
        lines($, $(a))
          .filter((l) => !BADGE.test(l))
          .sort((x, y) => y.length - x.length)[0] ||
        "";
      return {
        title,
        priceText: /\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?/.exec(text)?.[0] ?? "",
        url: abs("https://www.target.com", $(a).attr("href")).split(/[?#]/)[0],
        sponsored: /\bSponsored\b/.test(text),
      };
    })
    .get();
}

// Sponsored results prefix the title block with the ad label and its screen-reader explanation.
const AMAZON_AD = /^(?:Sponsored\s*)+(?:You[’']re seeing this ad based on the product[’']s relevance to your search query\.?\s*)?(?:Leave ad feedback\s*)?/i;

function amazon($: $): Raw[] {
  return $('[data-component-type="s-search-result"]')
    .map((_, e) => {
      const card = $(e);
      const link = card.find("h2").closest("a").first().length ? card.find("h2").closest("a").first() : card.find("a.a-link-normal").first();
      return {
        // h2 can hold only the brand; the full name sits in the title recipe block.
        title: (clean(card.find('[data-cy="title-recipe"]').first().text()) || clean(card.find("h2").text())).replace(AMAZON_AD, ""),
        priceText: clean(card.find(".a-price .a-offscreen").first().text()),
        url: abs("https://www.amazon.com", link.attr("href")).split("?")[0].split("/ref=")[0],
        sponsored: /\bSponsored\b/.test(card.text()),
      };
    })
    .get();
}

function costco($: $): Raw[] {
  // Tiles are tagged ProductTile_<item number>; nested nodes reuse that prefix with a suffix.
  return $('[data-testid^="ProductTile_"]')
    .filter((_, e) => /^ProductTile_\d+$/.test($(e).attr("data-testid") ?? ""))
    .map((_, e) => {
      const card = $(e);
      const a = card.find('a[href*=".product."]').first();
      const priceText = clean(card.find('[data-testid^="Text_Price_"]').first().text()) || clean(card.text());
      return {
        title: clean(card.find('[data-testid$="_title"]').first().text()) || clean(a.text()),
        priceText: /\$[\d,]+\.\d{2}/.exec(priceText)?.[0] ?? "",
        url: abs("https://www.costco.com", a.attr("href")).split("?")[0],
        sponsored: false,
      };
    })
    .get();
}

const PARSERS: Record<Store, ($: $) => Raw[]> = { walmart, target, amazon, costco };

export function parse(store: Store, html: string): Raw[] {
  const seen = new Set<string>();
  return PARSERS[store](cheerio.load(html))
    .filter((r) => r.title && r.url && !seen.has(r.url) && seen.add(r.url))
    .slice(0, 12);
}
