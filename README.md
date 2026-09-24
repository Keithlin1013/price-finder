# Price Finder 比价

**English** | [简体中文](README.zh-CN.md)

Enter a product name or barcode (UPC) and Price Finder checks **Walmart, Target, Amazon and Costco** at once, finds the same product at each store, and ranks the offers by **unit price** (per fl oz, oz, lb, count or load), so different package sizes compare fairly. A comparison takes about 15 seconds.

---

## The key point: it runs in **your own Chrome**

Price Finder does **not** launch a separate "bot browser". It uses no scraping service, no rotating IPs, and no random, temporary or automated browser.

How it works:

- You install a small extension (the `extension/` folder) in **the Chrome you already use every day**.
- When you compare, the extension opens **background tabs** in **your current Chrome window**, right next to the Price Finder page, one for each store's **search results page**.
- Those tabs carry **your own sign-ins, membership warehouse, store, delivery address and browsing history**, exactly as if you had opened the pages yourself.
- Once a page is read, the extension closes the tab and hands the page to the server running locally on your computer.

### Why it has to be your own Chrome

Other approaches were tried during development and did not work:

| Approach | Result |
|---|---|
| Launching a separate Chrome with an automation tool such as Playwright | Target and Walmart quickly showed a "Press & hold" bot check. macOS also blocked the program from controlling Chrome, and the window was closed outright |
| A brand-new, empty standalone Chrome profile | No sign-ins and no history meant a high risk score; opening a second page got blocked |
| A paid search API (SerpApi) | Worked for Walmart and Amazon, but has **no Target API**, and Costco was unreliable |
| **Your own signed-in Chrome + the extension (current approach)** | Reliable. It looks the same as you browsing the sites yourself, and prices reflect your warehouse, store and address |

### What it does **not** do

- It never bypasses, cracks or auto-completes a CAPTCHA or "Press & hold" check. When a check appears it stops and waits for you to do it yourself.
- It never rotates IPs, spoofs a browser fingerprint or uses a proxy.
- It never crawls product detail pages in bulk; each store gets **1 search page** per comparison.
- It never places orders, adds to cart, or changes any of your account settings.

---

## How it works

```
 You type a product at localhost:3001 and press Compare
        │
        ▼
 ① The page asks the local server: was this product looked up in the last 24 hours?
        │   Stores already looked up come from the cache; no page is opened
        ▼
 ② The page sends the extension the search URL and pacing for each remaining store
        │
        ▼
 ③ The extension opens one background tab per store in your Chrome (all four at once)
        │   · At least 20 s between two loads of the same site, at most 12 loads an hour
        │   · After the page loads it waits briefly and scrolls so the product cards render
        │   · If a check appears: that tab comes to the front and waits for you to press & hold, up to 5 minutes
        ▼
 ④ The extension returns the whole page (HTML) to the Price Finder page and closes the tab
        │
        ▼
 ⑤ The local server parses the page for each product's name, price and link (lib/parse.ts)
        │   Walmart: the product data embedded in the page first; the other three: the product cards
        ▼
 ⑥ TypeSafe decides whether each result is the same product you asked for (lib/match.ts)
        │
        ▼
 ⑦ Results are shown ranked by unit price: the cheapest as a large sign, the rest in order;
    results that are not the same product get a stamp: other brand / other line / other variant / other form
```

### Who does what

| Part | Responsibility | Location |
|---|---|---|
| **Chrome extension** | Only opens pages in your Chrome, detects bot checks, and returns the page HTML. Search URLs and pacing come from the page | `extension/` |
| **Compare page** | Search field, the four store progress cards (tap one to show only that store), result signs | `app/page.tsx`, `app/globals.css` |
| **Page parsing** | Pulls name, price and link from each store's search page | `lib/parse.ts` |
| **Same-product matching** | Calls TypeSafe to check brand, product line, variant and form | `lib/match.ts` |
| **Unit prices** | Reads size and pack count from the title and computes the price per unit | `lib/units.ts`, `lib/stores.ts` |
| **Caches** | Search results, the last page per store, TypeSafe verdicts | `.cache/` (local only, never committed) |

Parsing, URLs and pacing all live in the server and the page, so **changing them does not require reloading the extension**. Only changes to the code in `extension/` do.

### How a match is decided

For every result, TypeSafe answers six yes/no questions:

1. Does the title name a brand? (If not, question 2 is skipped and the product line decides.)
2. Is it the same brand as the one you want?
3. Is it the same product line? (Every qualifier word counts: Platinum and Platinum Plus are different lines.)
4. Is the scent or flavor compatible? (A title that states no scent counts as compatible.)
5. Is it the same physical form? (Liquid, powder, gel, pods, and so on; a query that states no form accepts any.)
6. Is it the same kind of product? (Laundry detergent, hand soap, and so on.)

**In same-product mode all six must pass. Size and pack count are never checked**, because results are ranked per unit. Verdicts are stored per query and product title in `.cache/verdicts/`, so the same listing gets the same answer every time; when the rules change, old verdicts are discarded and results are judged again.

### Two ways to compare: same product / similar too

- **Same product**: all the checks above must pass. For a specific product, such as "Tide Ultra Concentrated Original 170 fl oz".
- **Similar too**: only the **kind of product** must match (both laundry detergent, both hand soap); the brand or scent is required only when your query names one. For broad searches such as "Tide laundry detergent" or "hand soap refill".

TypeSafe first decides whether your query names one specific product or a kind of product and picks the mode (a barcode is always same-product). A "Same product / Similar too" switch sits next to the results heading; switching recombines verdicts for the results already read and never loads the stores again.

### How unit prices are computed

The size is read from the title (`fl oz`, `oz`, `lb`, `L`, `ml`, `gal`, `loads`, `count / ct`, and so on) and multiplied by the pack count (`Pack of 6`, `2-pack`, and so on) to get the price per unit. Ranking prefers a unit you typed in your query, with volume and weight first.

---

## Setup and use

### Requirements

- macOS or Windows with **Google Chrome**
- Node.js 20 or later
- A TypeSafe API key (get one at https://console.typesafe.ai/)

### 1. Install the project

```bash
git clone https://github.com/Keithlin1013/price-finder.git
cd price-finder
npm install
```

### 2. Add your API key (never commit it)

Create `.env.local` in the project root with one line:

```
TYPESAFE_API_KEY=your-key
```

`.env.local` is listed in `.gitignore`, so it is **never committed to GitHub**.

### 3. Install the extension in your own Chrome

1. If the project lives in a **folder that iCloud syncs** (such as Desktop or Documents), copy the extension somewhere that is not synced first. While iCloud sync is paused, Chrome can read stale files:
   ```bash
   mkdir -p ~/price-finder-extension && cp extension/* ~/price-finder-extension/
   ```
2. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `~/price-finder-extension` (or the project's `extension` folder).
4. Check that **Price Finder** appears in the list, version **0.4.0** or later.

### 4. Sign in to the four stores in that Chrome

In the Chrome that has the extension, sign in to Walmart, Target, Amazon and Costco, and set your store, membership warehouse or delivery address. **Prices are shown according to these settings.**

### 5. Start it and compare

```bash
npm run dev -- --port 3001
```

Open http://localhost:3001 in **the same Chrome**, enter a product name or barcode, and press Compare.

- A few background tabs appear next to the page and close on their own when done.
- Once results are in, tap any store card at the top to show only that store's offers; tap it again or press "All stores" to go back.
- If a store shows a bot check, its tab comes to the front; press and hold to continue.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The Compare button is grey and says no extension was detected | The extension is not installed or not enabled; after installing it, **reload** the Price Finder page |
| It says the extension is too old | In `chrome://extensions`, press ↻ on Price Finder; if the project is in an iCloud-synced folder, copy it to `~/price-finder-extension` again first |
| It stays on "Starting" and after 20 s says the extension did not respond | Same as above: reload the extension, then reload the page |
| Pressing Compare in **full-screen mode** closed all of Chrome | Early versions opened a new window, which could close Chrome in full screen. Since 0.2.1 it uses background tabs; if it still happens, leave full screen first |
| One store keeps showing a bot check | Too many visits in a short time. Wait a while and avoid running many comparisons back to back |
| One store shows 0 results | The site may have changed its layout. The last page per store is saved in `.cache/pages/`; update `lib/parse.ts` against it |

---

## Limits

- Prices come from each store's **search results page**; the checkout price can differ because of shipping, membership, store or promotions.
- When a Target product has several sizes, its card shows a price range; open the product page to confirm.
- Barcode searches: Walmart needs a 14-digit GTIN (zeros are added automatically); Amazon often lists the main product under a different identifier, so a name search may find more.
- This is a low-volume tool for personal use. Store terms of service generally do not allow automated collection, so do not turn it into a high-volume, bulk, or third-party service.

## Trademarks

The Walmart, Target, Amazon and Costco names and logos belong to their respective companies and are used here only to identify each store. The Walmart, Target and Amazon icon data comes from [Simple Icons](https://simpleicons.org/) (CC0); `public/costco-logo.png` is the logo image used on costco.com.
