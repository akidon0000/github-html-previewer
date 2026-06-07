// Controller for the preview tab. Reads the stashed HTML from session storage
// (an extension-page privilege the sandboxed renderer doesn't have) and hands it
// to the sandboxed iframe via postMessage. The sandbox runs under a permissive
// CSP, so the previewed page's scripts (e.g. Mermaid) actually execute.

const sandbox = document.getElementById("sandbox");
const srcEl = document.getElementById("src");
const reloadBtn = document.getElementById("reload");
const toggleScripts = document.getElementById("toggle-scripts");

let current = null; // { html, rawBase, sourceUrl }
let sandboxReady = false;

function post() {
  if (!current || !sandboxReady) return;
  sandbox.contentWindow.postMessage(
    {
      type: "ghhp-render",
      html: current.html,
      rawBase: current.rawBase,
      allowScripts: toggleScripts.checked
    },
    "*"
  );
}

// The sandboxed page has an opaque origin, so we identify it by window, not origin.
window.addEventListener("message", (e) => {
  if (e.source === sandbox.contentWindow && e.data?.type === "ghhp-sandbox-ready") {
    sandboxReady = true;
    post();
  }
});

reloadBtn.addEventListener("click", post);
toggleScripts.addEventListener("change", post);

(async () => {
  const { preview } = await chrome.storage.session.get("preview");
  if (!preview) {
    srcEl.textContent =
      "プレビューするデータがありません。GitHub の HTML ファイルで「Preview」を押すか、ポップアップから貼り付けてください。";
    return;
  }
  current = preview;
  srcEl.textContent = preview.sourceUrl || "(pasted HTML)";
  const name = (preview.sourceUrl || "").split("/").pop() || "HTML";
  document.title = `Preview – ${name}`;
  post(); // in case the sandbox was already ready
})();
