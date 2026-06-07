// Service worker. Receives the file's HTML from the content script (read from
// the page DOM, so it works for private repos too). If the content script
// couldn't read it, we fetch the public raw file ourselves (content scripts
// can't, due to page CORS; the worker can via host_permissions). We stash it for
// the preview controller to pick up, and — for the "other tab" mode — open the
// preview tab. Inline mode just stores and lets the embedded controller read it.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "OPEN_PREVIEW") {
    openPreview(msg).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

async function openPreview({ html, rawUrl, rawBase, sourceUrl, openTab }) {
  try {
    if (html == null) {
      const res = await fetch(rawUrl, { credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      html = await res.text();
    }
    await chrome.storage.session.set({
      preview: { html, rawBase, sourceUrl, fetchedAt: Date.now() }
    });
    if (openTab) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/preview.html") });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
