"use client";

import { useEffect, useRef, useState } from "react";
import type { Judged } from "@/lib/match";
import { type Offer, PACING, searchUrl, type Store } from "@/lib/stores";
import type { Unit, UnitPrice } from "@/lib/units";
import { IMAGE_LOGOS, LOGOS } from "@/lib/logos";

type StoreStatus =
  | { state: "queued" }
  | { state: "waiting"; until: number } // pacing gap before this store's page load
  | { state: "loading" }
  | { state: "challenge" } // the site wants a human check in the store tab
  | { state: "done"; cached: boolean; count: number }
  | { state: "error"; message: string };

type Ranked = Judged & { unitPrices: UnitPrice[] };

const STORE_NAMES = { walmart: "Walmart", target: "Target", amazon: "Amazon", costco: "Costco" } as const;
const STORES = Object.keys(STORE_NAMES) as Store[];
const SAME = 0.5;
// The page sends search URLs and pacing to the extension; versions before this expect another message.
const MIN_EXTENSION = "0.4.0";

const UNIT_ZH: Record<Unit, string> = { "fl oz": "每液量盎司", oz: "每盎司", lb: "每磅", count: "每个", load: "每次洗涤" };

const EXAMPLES = [
  "Tide Ultra Concentrated Liquid Laundry Detergent, Original, 152 Loads, 170 fl oz",
  "Softsoap Aquarium Liquid Hand Soap Refill, 50 fl oz",
  "030772063569",
];

function older(v: string, min: string) {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

const QUEUED: Record<Store, StoreStatus> = {
  walmart: { state: "queued" },
  target: { state: "queued" },
  amazon: { state: "queued" },
  costco: { state: "queued" },
};

// Each store's state prints as one receipt line: Chinese, then the English word.
function statusLine(s: StoreStatus, now: number): { zh: string; en: string } {
  switch (s.state) {
    case "queued":
      return { zh: "准备中", en: "STARTING" };
    case "waiting":
      return { zh: `等待 ${Math.max(0, Math.ceil((s.until - now) / 1000))} 秒`, en: "PACING THIS SITE" };
    case "loading":
      return { zh: "正在读取搜索结果", en: "READING" };
    case "challenge":
      return { zh: "请到旁边的标签页按住验证", en: "HUMAN CHECK" };
    case "done":
      return { zh: `${s.count} 个结果${s.cached ? "（今日缓存）" : ""}`, en: s.cached ? "CACHED" : "DONE" };
    case "error":
      return { zh: s.message, en: "FAILED" };
  }
}

// The store's own mark beside its name; the name stays, since a bare mark is not always legible.
function StoreMark({ store }: { store: Store }) {
  const image = store in IMAGE_LOGOS ? IMAGE_LOGOS[store as keyof typeof IMAGE_LOGOS] : null;
  if (image) {
    return (
      <span className="store-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="store-logo store-wordmark store-image" src={image.src} alt={STORE_NAMES[store]} style={{ aspectRatio: String(image.aspect) }} />
      </span>
    );
  }
  const logo = store in LOGOS ? LOGOS[store as keyof typeof LOGOS] : null;
  const wordmark = !!logo && "wordmark" in logo && logo.wordmark;
  return (
    <span className="store-mark">
      {logo && (
        <svg
          className={wordmark ? "store-logo store-wordmark" : "store-logo"}
          viewBox={logo.viewBox}
          fill={logo.color}
          role={wordmark ? "img" : undefined}
          aria-label={wordmark ? STORE_NAMES[store] : undefined}
          aria-hidden={wordmark ? undefined : true}
          dangerouslySetInnerHTML={{ __html: logo.body }}
        />
      )}
      {!wordmark && <span>{STORE_NAMES[store]}</span>}
    </span>
  );
}

function money(n: number | null) {
  return n === null ? "" : `$${n.toFixed(2)}`;
}

// "17.6" + "¢" for sub-dollar unit prices, "$1.29" otherwise.
function unitFigure(u: UnitPrice): { value: string; mark: string; before: boolean } {
  return u.price < 1 ? { value: (u.price * 100).toFixed(1), mark: "¢", before: false } : { value: u.price.toFixed(2), mark: "$", before: true };
}

function rankUnit(o: Ranked, unit: Unit | null): UnitPrice | undefined {
  return o.unitPrices.find((u) => u.unit === unit) ?? o.unitPrices[0];
}

function Figure({ u, size }: { u: UnitPrice; size: "hero" | "card" }) {
  const f = unitFigure(u);
  return (
    <div className={`figure figure-${size}`}>
      <span className="figure-num">
        {f.before && <span className="figure-mark">{f.mark}</span>}
        {f.value}
        {!f.before && <span className="figure-mark">{f.mark}</span>}
      </span>
      <span className="figure-unit">
        <span className="zh">{UNIT_ZH[u.unit]}</span>
        <span className="en">PER {u.unit.toUpperCase()}</span>
      </span>
    </div>
  );
}

function Facts({ o }: { o: Ranked }) {
  const facts = [
    o.priceText ? `${o.priceText}${o.packCount > 1 ? ` · ${o.packCount} 件装` : ""}` : "",
    o.packCount > 1 ? `每包 ${money(o.perUnit)}` : "",
    o.sponsored ? "广告位 Sponsored" : "",
    o.priceText.includes("-") ? "多规格价格区间，请打开商品页确认" : "",
  ].filter(Boolean);
  return (
    <ul className="facts">
      {facts.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}

function Sign({ o, unit, rank, lead, filtered }: { o: Ranked; unit: Unit | null; rank: number; lead?: boolean; filtered?: boolean }) {
  const u = rankUnit(o, unit);
  return (
    <article className={`sign${lead ? " sign-lead" : ""}`} style={{ ["--i" as string]: rank }}>
      <span className="clip clip-l" aria-hidden />
      <span className="clip clip-r" aria-hidden />
      <header className="sign-head">
        <span className="store-tag">
          <StoreMark store={o.store} />
        </span>
        {lead && (
          <span className="lead-label">
            <span className="zh">{filtered ? "这家单价最低" : "单价最低"}</span>
            <span className="en">{filtered ? "LOWEST AT THIS STORE" : "LOWEST PER UNIT"}</span>
          </span>
        )}
      </header>
      {u ? (
        <Figure u={u} size={lead ? "hero" : "card"} />
      ) : (
        <div className="figure figure-card figure-none">{o.priceText || "无价格"}</div>
      )}
      <a className="sign-title" href={o.url} target="_blank" rel="noreferrer">
        {o.title}
      </a>
      <Facts o={o} />
    </article>
  );
}

// The stamp names the first check the offer failed.
const MISMATCH: Record<string, { zh: string; en: string }> = {
  brand: { zh: "不同品牌", en: "OTHER BRAND" },
  line: { zh: "不同系列", en: "OTHER LINE" },
  form: { zh: "不同形态", en: "OTHER FORM" },
  variant: { zh: "不同香型", en: "OTHER VARIANT" },
};

function Stamped({ o, unit }: { o: Ranked; unit: Unit | null }) {
  const u = rankUnit(o, unit);
  const f = u ? unitFigure(u) : null;
  const why = (o.mismatch && MISMATCH[o.mismatch]) || { zh: "不同款", en: "NOT A MATCH" };
  return (
    <article className="sign sign-void">
      <span className="stamp" aria-label={`${why.zh} ${why.en}`}>
        <span className="zh">{why.zh}</span>
        <span className="en">{why.en}</span>
      </span>
      <header className="sign-head">
        <span className="store-tag">
          <StoreMark store={o.store} />
        </span>
        <span className="void-price">
          {o.priceText}
          {f && u ? ` · ${f.before ? f.mark : ""}${f.value}${f.before ? "" : f.mark}/${u.unit}` : ""}
        </span>
      </header>
      <a className="sign-title" href={o.url} target="_blank" rel="noreferrer">
        {o.title}
      </a>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="rack" aria-hidden>
      <div className="sign sign-lead sign-skeleton">
        <span className="bar w30" />
        <span className="bar w60 tall" />
        <span className="bar w80" />
      </div>
      <div className="rack-row">
        {[0, 1].map((i) => (
          <div key={i} className="sign sign-skeleton">
            <span className="bar w30" />
            <span className="bar w50 mid" />
            <span className="bar w80" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [extension, setExtension] = useState<boolean | null>(null);
  const [extVersion, setExtVersion] = useState("");
  const [stores, setStores] = useState<Record<Store, StoreStatus> | null>(null);
  const [offers, setOffers] = useState<Ranked[] | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  // Store filter over the results: null shows every store.
  const [only, setOnly] = useState<Store | null>(null);
  const run = useRef<{ id: string; q: string; offers: Partial<Record<Store, Offer[]>> } | null>(null);
  // Saving a store's results is async; "done" must wait for the last save, so messages are handled in order.
  const inbox = useRef<Promise<unknown>>(Promise.resolve());
  // Cleared by the first message of a run; if nothing arrives the extension is not answering.
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function finish() {
    const r = run.current;
    if (!r) return;
    const all = STORES.flatMap((s) => r.offers[s] ?? []);
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: r.q, offers: all }),
    });
    const data = await res.json();
    if (!res.ok) setError(`TypeSafe 判断失败：${data.error}`);
    setOffers(data.offers ?? []);
    setUnit(data.unit ?? null);
    setBusy(false);
  }

  useEffect(() => {
    const handle = async (m: any) => {
      // Results from a run this page did not start (e.g. one begun before a reload) are dropped,
      // otherwise they would be cached under the wrong query.
      if (m.type !== "ready" && m.runId !== run.current?.id) return;
      if (m.type !== "ready" && silence.current) {
        clearTimeout(silence.current);
        silence.current = null;
      }
      if (m.type === "ready") {
        setExtVersion(m.version ?? "");
        return setExtension(true);
      }
      if (m.type === "status") setStores((s) => s && { ...s, [m.store]: m.status });
      if (m.type === "error") {
        setError(m.message);
        setStores(null);
        setBusy(false);
        run.current = null;
        return;
      }
      if (m.type === "page" && run.current) {
        const res = await fetch("/api/offers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: run.current.q, store: m.store, html: m.html }),
        });
        const saved = await res.json();
        run.current.offers[m.store as Store] = saved.offers;
        setStores((s) => s && { ...s, [m.store]: { state: "done", cached: false, count: saved.offers.length } });
      }
      if (m.type === "done") await finish();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "price-finder-extension") return;
      inbox.current = inbox.current.then(() => handle(e.data)).catch((err) => setError(String(err)));
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "price-finder-page", type: "ping" }, "*");
    const t = setTimeout(() => setExtension((x) => x ?? false), 1500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(t);
      clearInterval(clock);
    };
  }, []);

  async function compare() {
    const q = query.trim();
    if (!q) return;
    setError("");
    setOffers(null);
    setOnly(null);
    setBusy(true);
    // Stores with results from the last 24 h are not loaded again.
    const cached: Record<Store, Offer[] | null> = await fetch(`/api/offers?q=${encodeURIComponent(q)}`).then((r) => r.json());
    run.current = { id: crypto.randomUUID(), q, offers: {} };
    const status = { ...QUEUED };
    const missing: Store[] = [];
    for (const s of STORES) {
      if (cached[s]) {
        run.current.offers[s] = cached[s]!;
        status[s] = { state: "done", cached: true, count: cached[s]!.length };
      } else missing.push(s);
    }
    setStores(status);
    if (missing.length === 0) return finish();
    silence.current = setTimeout(() => {
      setError("扩展没有回应。请到 chrome://extensions 点 Price Finder 的 ↻，再刷新本页。");
      setStores(null);
      setBusy(false);
      run.current = null;
    }, 20_000);
    window.postMessage(
      {
        source: "price-finder-page",
        type: "compare",
        runId: run.current.id,
        pages: missing.map((store) => ({ store, url: searchUrl(store, q) })),
        opts: PACING,
      },
      "*",
    );
  }

  const outdated = !!extVersion && older(extVersion, MIN_EXTENSION);
  const ready = !!extension && !outdated;
  const allSame = offers ? offers.filter((o) => o.same >= SAME && o.price !== null) : [];
  const allOthers = offers ? offers.filter((o) => !(o.same >= SAME && o.price !== null)) : [];
  const same = only ? allSame.filter((o) => o.store === only) : allSame;
  const others = only ? allOthers.filter((o) => o.store === only) : allOthers;
  const anyDone = !!stores && Object.values(stores).some((s) => s.state === "done");
  // Once results are in, each store's upright becomes a filter button.
  const filterable = !!offers && anyDone;
  const matchCount = (s: Store) => allSame.filter((o) => o.store === s).length;

  const notice = error
    ? error
    : extension === false
    ? "这个 Chrome 里没有检测到 Price Finder 扩展。安装方法见 README。"
    : outdated
    ? `扩展是 v${extVersion}，本页需要 v${MIN_EXTENSION}。请到 chrome://extensions 点 ↻，再刷新本页。`
    : "";

  return (
    <>
      <header className="beam">
        <div className="beam-inner">
          <div className="brand">
            <span className="zh">比价</span>
            <span className="en">PRICE FINDER</span>
          </div>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              compare();
            }}
          >
            <label className="search-label" htmlFor="q">
              <span className="zh">商品名或条码</span>
              <span className="en">PRODUCT OR BARCODE</span>
            </label>
            <div className="search-row">
              <input
                id="q"
                className="search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="例如 Tide Original 170 fl oz"
                autoComplete="off"
                enterKeyHint="search"
              />
              <button className="compare" type="submit" disabled={busy || !query.trim() || !ready}>
                <span className="zh">{busy ? "比价中" : "比价"}</span>
                <span className="en">COMPARE</span>
              </button>
            </div>
          </form>
        </div>
      </header>

      <main className="floor">
        {notice && (
          <p className={`notice${error ? " notice-error" : ""}`} role="status">
            {notice}
          </p>
        )}

        {stores ? (
          <section className="uprights" aria-label="各店进度 Store progress">
            {STORES.map((s) => {
              const line = statusLine(stores[s], now);
              const body = (
                <>
                  <span className="upright-name">
                    <StoreMark store={s} />
                  </span>
                  <span className="upright-line">
                    <span className="zh">{filterable && stores[s].state === "done" ? `${matchCount(s)} 个同款，共 ${line.zh}` : line.zh}</span>
                    <span className="en">{filterable ? (only === s ? "SHOWING ONLY THIS STORE" : "TAP TO SHOW ONLY") : line.en}</span>
                  </span>
                </>
              );
              const cls = `upright is-${stores[s].state}${only === s ? " is-selected" : ""}${only && only !== s ? " is-dimmed" : ""}`;
              return filterable ? (
                <button
                  key={s}
                  type="button"
                  className={`${cls} upright-button`}
                  aria-pressed={only === s}
                  onClick={() => setOnly((cur) => (cur === s ? null : s))}
                >
                  {body}
                </button>
              ) : (
                <div key={s} className={cls}>
                  {body}
                </div>
              );
            })}
          </section>
        ) : (
          !notice && (
            <section className="intro">
              <h1 className="intro-title">
                <span className="zh">四家店，按单价比。</span>
                <span className="en">FOUR STORES, COMPARED PER UNIT</span>
              </h1>
              <p className="intro-copy">输入商品名或条码，约 15 秒后按每盎司、每件或每次洗涤的价格排好。</p>
              <div className="examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="example" onClick={() => setQuery(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </section>
          )
        )}

        {busy && !offers && <Skeleton />}

        {offers && anyDone && (
          <section className="rack" aria-label="比价结果 Results">
            <div className="rack-head">
              <h2 className="rack-title">
                <span className="zh">
                  {only ? `${STORE_NAMES[only]}：` : ""}
                  {same.length ? `${same.length} 个同款报价` : only ? "这家没有同款" : "没有找到同款"}
                </span>
                <span className="en">
                  {same.length ? `SORTED ${unit ? `PER ${unit.toUpperCase()}` : "PER UNIT"}` : only ? "TRY ANOTHER STORE" : "TRY THE FULL NAME OR THE BARCODE"}
                </span>
              </h2>
              {only && (
                <button type="button" className="show-all" onClick={() => setOnly(null)}>
                  <span className="zh">显示全部</span>
                  <span className="en">ALL STORES</span>
                </button>
              )}
            </div>

            {same[0] && <Sign key={`lead-${only ?? "all"}`} o={same[0]} unit={unit} rank={0} lead filtered={!!only} />}

            {same.length > 1 && (
              <div className="rack-row">
                {same.slice(1).map((o, i) => (
                  <Sign key={`${o.store}-${i}`} o={o} unit={unit} rank={i + 1} />
                ))}
              </div>
            )}

            {others.length > 0 && (
              <details className="voids">
                <summary>
                  <span className="zh">{others.length} 个不同款</span>
                  <span className="en">NOT THE SAME PRODUCT</span>
                </summary>
                <div className="rack-row">
                  {others.map((o, i) => (
                    <Stamped key={`${o.store}-void-${i}`} o={o} unit={unit} />
                  ))}
                </div>
              </details>
            )}

            <p className="fine">价格来自各店搜索结果，结账时可能因运费、会员和门店不同而变化。同款判断由 TypeSafe 完成。</p>
          </section>
        )}

        <footer className="floor-foot">
          {extVersion ? `扩展 v${extVersion}` : ""}
          {extVersion ? " · " : ""}每个网站至少间隔 20 秒访问一次，同一商品 24 小时内用缓存
        </footer>
      </main>
    </>
  );
}
