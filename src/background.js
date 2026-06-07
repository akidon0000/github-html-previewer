// Service worker. Content scripts can't do the cross-origin fetch to
// raw.githubusercontent.com (page CORS applies to them), but the worker can
// thanks to host_permissions. So the content script asks us to fetch the raw
// HTML and we hand the text back.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "FETCH_RAW") {
    fetchRaw(msg.rawUrl).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

async function fetchRaw(rawUrl) {
  try {
    const res = await fetch(rawUrl, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
