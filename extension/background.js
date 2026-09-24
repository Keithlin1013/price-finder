// Price Finder: loads store search pages in the person's own Chrome and hands the HTML to the
// local Price Finder page. Which pages to load and how fast come from the page (lib/stores.ts),
// and parsing happens on the server (lib/parse.ts), so neither needs this extension reloaded.
//
// Stores are loaded in parallel, one background tab each; pacing is per site: each site gets at
// least `gapMs` between its own page loads and at most `hourlyCap` loads an hour.
const CHALLENGE = /press & hold|robot or human|quick verification|enter the characters you see|verify you are a human/i;
const CHALLENGE_WAIT_MS = 5 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageHtml() {
  return document.documentElement.outerHTML;
}

function pageText() {
  return document.body ? document.body.innerText.slice(0, 3000) : "";
}

function scrollDown() {
  window.scrollBy(0, 1200);
}

async function run(tabId, fn) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: fn });
  return res?.result;
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, 45_000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function recentLoads(store) {
  const key = `loads_${store}`;
  const { [key]: loads = [] } = await chrome.storage.local.get(key);
  return loads.filter((t) => t > Date.now() - 3_600_000);
}

async function readStore({ store, url }, opts, pageTab, report) {
  const loads = await recentLoads(store);
  if (loads.length >= opts.hourlyCap) {
    const min = Math.ceil((loads[0] + 3_600_000 - Date.now()) / 60_000);
    throw new Error(`Reached ${opts.hourlyCap} loads of this site this hour. Try again in about ${min} min.`);
  }
  const wait = (loads.at(-1) ?? 0) + opts.gapMs - Date.now();
  if (wait > 0) {
    report({ state: "waiting", until: Date.now() + wait });
    await sleep(wait);
  }
  report({ state: "loading" });
  await chrome.storage.local.set({ [`loads_${store}`]: [...(await recentLoads(store)), Date.now()] });
  const tab = await chrome.tabs.create({ windowId: pageTab.windowId, index: pageTab.index + 1, active: false, url: "about:blank" });
  try {
    const loaded = waitForLoad(tab.id);
    await chrome.tabs.update(tab.id, { url });
    await loaded;
    await sleep(opts.settleMs);
    for (let i = 0; i < opts.scrolls; i++) {
      await run(tab.id, scrollDown);
      await sleep(600);
    }
    if (CHALLENGE.test((await run(tab.id, pageText)) || "")) {
      // Bring the tab forward and wait for the person to press & hold; never retry on our own.
      report({ state: "challenge" });
      await chrome.tabs.update(tab.id, { active: true });
      const until = Date.now() + CHALLENGE_WAIT_MS;
      while (Date.now() < until && CHALLENGE.test((await run(tab.id, pageText).catch(() => "")) || "")) await sleep(3000);
      if (CHALLENGE.test((await run(tab.id, pageText).catch(() => "")) || "")) throw new Error("The check was not completed within 5 minutes.");
      await sleep(opts.settleMs);
    }
    return (await run(tab.id, pageHtml)) || "";
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

let busy = false;

async function compare({ runId, pages, opts }, pageTabId) {
  // Every message carries the run it belongs to, so a reloaded page ignores an older run's results.
  const send = (msg) => chrome.tabs.sendMessage(pageTabId, { ...msg, runId }).catch(() => {});
  if (busy) return send({ type: "error", message: "Another comparison is still running. Wait for it to finish, then try again." });
  busy = true;
  // A service worker is stopped after ~30 s without extension API calls; pacing waits can be longer.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 10_000);
  try {
    const pageTab = await chrome.tabs.get(pageTabId);
    await Promise.all(
      pages.map(async (p) => {
        try {
          const html = await readStore(p, opts, pageTab, (s) => send({ type: "status", store: p.store, status: s }));
          send({ type: "page", store: p.store, html });
        } catch (e) {
          send({ type: "status", store: p.store, status: { state: "error", message: String(e.message || e) } });
        }
      }),
    );
  } finally {
    clearInterval(keepAlive);
    busy = false;
    send({ type: "done" });
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "compare" && sender.tab) compare(msg, sender.tab.id);
});
