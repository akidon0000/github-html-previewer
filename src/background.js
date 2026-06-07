// Service worker. Content scripts can't fetch cross-origin to
// raw.githubusercontent.com (page CORS applies to them), but the worker can via
// host_permissions. We fetch the raw HTML, stash it in session storage under a
// one-shot key, and return the key. The inline preview frame (an extension page,
// so it's outside github.com's CSP) reads it back by key.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "FETCH_RAW") {
    fetchRaw(msg).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

async function fetchRaw({ rawUrl, rawBase }) {
  try {
    const res = await fetch(rawUrl, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const key = `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await chrome.storage.session.set({ [key]: { html, rawBase } });
    return { ok: true, key };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
