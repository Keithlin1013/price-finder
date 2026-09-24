// Bridges the Price Finder page (localhost:3001) and the extension's background worker.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "price-finder-page") return;
  if (e.data.type === "ping") {
    const version = chrome.runtime.getManifest().version;
    return window.postMessage({ source: "price-finder-extension", type: "ready", version }, "*");
  }
  chrome.runtime.sendMessage(e.data);
});
chrome.runtime.onMessage.addListener((msg) => {
  window.postMessage({ ...msg, source: "price-finder-extension" }, "*");
});
