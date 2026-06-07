// Runs inside the embedded extension page. Reads the stashed HTML (by the key in
// the URL hash) from session storage and renders it into a sandboxed iframe.

function injectBase(html, base) {
  if (!base) return html;
  const tag = `<base href="${base}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
  return tag + html;
}

function fail(text) {
  document.body.innerHTML = `<div id="msg">${text}</div>`;
}

(async () => {
  const key = decodeURIComponent(location.hash.slice(1));
  if (!key) return fail("プレビューデータがありません。");

  const store = await chrome.storage.session.get(key);
  const data = store[key];
  await chrome.storage.session.remove(key); // one-shot
  if (!data) return fail("プレビューデータが見つかりませんでした。");

  document.getElementById("frame").srcdoc = injectBase(data.html, data.rawBase);
})();
