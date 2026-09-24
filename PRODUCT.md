# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One shopper (the owner) comparing what the same household product costs at Walmart, Target,
Amazon and Costco before buying. Used both at a desk before ordering online, and on a phone,
including in a store, so results must read at a glance one-handed. Reads Chinese and English;
product names stay in English as the stores list them.

## Product Purpose

Enter a barcode (UPC) or a product name; get each store's matching offers ranked by price per
unit (per fl oz, oz, lb, count or load), so different package sizes compare fairly. Success is
knowing which store is cheapest for this product in about 15 seconds, without opening four sites.

## Positioning

Reads each store's search page in the shopper's own signed-in Chrome (their warehouse, store and
delivery address), then has TypeSafe judge which results are the same product and variant. No
scraping service, no rotating IPs, no detail-page crawling.

## Operating Context

- Local Next.js app at http://localhost:3001, opened in the same Chrome that has the Price Finder
  extension installed and is signed in to the four stores.
- A comparison opens one background tab per store in parallel, then closes them. Each site is
  visited at most once per 20 s and 12 times an hour; results are cached for 24 h per query.
- A store can ask for a human check ("press & hold"); the lookup pauses until the shopper completes
  it in that tab, up to 5 minutes.

## Capabilities and Constraints

- Stores: Walmart, Target, Amazon, Costco. Prices are what search results show; checkout can
  differ (shipping, membership, store). Target shows price ranges for multi-size listings.
- Matching: same brand, product line and variant; size and pack count may differ.
- Per-store states: starting, pausing for pacing, loading, needs human check, done (n results,
  possibly from cache), error.
- The extension version must be at least the one the page requires; the page says so otherwise.

## Brand Commitments

Name: Price Finder. No logo. Interface copy is bilingual: Chinese first, with short English
keywords where they help (store names and product titles stay English).

## Evidence on Hand

Real results only, from the stores at query time. No invented prices, savings claims, or ratings.

## Product Principles

1. The cheapest matching offer per unit is the answer; everything else supports it.
2. Show why an offer counts (store, size, pack, unit price) so the ranking can be trusted.
3. Never hide a store's state: waiting, needs a human, failed, or cached.
4. Stay polite to the stores; speed never comes from evading their checks.
