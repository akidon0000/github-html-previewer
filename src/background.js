// Service worker. Receives the file's HTML from the content script (read from
// the page DOM, so it works for private repos too). If the content script
// couldn't read it, we fetch the public raw file ourselves (content scripts
// can't, due to page CORS; the worker can via host_permissions).
//
// OPEN_PREVIEW (other-tab): stash the HTML and open the preview tab.
// FETCH_RAW (inline fallback): just return the raw HTML to the content script.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "OPEN_PREVIEW") {
    openPreview(msg).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (msg?.type === "FETCH_RAW") {
    fetchRaw(msg.rawUrl).then(sendResponse);
    return true;
  }
});

// Used by inline preview when the page DOM source isn't available (public repos).
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

async function openPreview({ html, rawUrl, rawBase, sourceUrl }) {
  try {
    if (html == null) {
      const res = await fetch(rawUrl, { credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      html = await res.text();
    }
    await chrome.storage.session.set({
      preview: { html, rawBase, sourceUrl, fetchedAt: Date.now() }
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/preview.html") });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
