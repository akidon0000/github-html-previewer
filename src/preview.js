// Controller for the preview. Reads the stashed HTML from session storage (an
// extension-page privilege the sandboxed renderer doesn't have) and hands it to
// the sandboxed iframe via postMessage. The sandbox runs under a permissive CSP,
// so the previewed page's scripts (e.g. Mermaid) actually execute.
//
// Handshake is driven off the iframe's "load" event (not a message ping), so the
// sandbox's listener is guaranteed to be attached before we post — no race.

const sandbox = document.getElementById("sandbox");
const srcEl = document.getElementById("src");
const reloadBtn = document.getElementById("reload");
const toggleScripts = document.getElementById("toggle-scripts");

let current = null; // { html, rawBase, sourceUrl }
let loaded = false;

function post() {
  if (!current || !loaded) return;
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

sandbox.addEventListener("load", () => {
  loaded = true;
  post();
});

// document.write replaces the sandbox doc (and its listener), so reload/toggle
// reload the sandbox page; its fresh "load" re-triggers post() with the current
// toggle state.
function reloadSandbox() {
  loaded = false;
  sandbox.src = "preview-sandbox.html";
}
reloadBtn.addEventListener("click", reloadSandbox);
toggleScripts.addEventListener("change", reloadSandbox);

(async () => {
  const { preview } = await chrome.storage.session.get("preview");
  if (!preview) {
    srcEl.textContent =
      "プレビューするデータがありません。GitHub の HTML ファイルで Preview を押すか、ポップアップから貼り付けてください。";
    return;
  }
  current = preview;
  srcEl.textContent = preview.sourceUrl || "(pasted HTML)";
  const name = (preview.sourceUrl || "").split("/").pop() || "HTML";
  document.title = `Preview – ${name}`;
  post(); // in case the iframe already fired "load"
})();
