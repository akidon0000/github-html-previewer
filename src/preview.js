// Reads the stashed HTML from session storage and renders it inside a sandboxed
// iframe. A <base> tag is injected so relative CSS/JS/images resolve against the
// file's directory on raw.githubusercontent.com.

const frame = document.getElementById("frame");
const srcEl = document.getElementById("src");
const reloadBtn = document.getElementById("reload");
const toggleScripts = document.getElementById("toggle-scripts");

const SANDBOX_BASE = ["allow-forms", "allow-popups", "allow-modals"];

let current = null;

function injectBase(html, base) {
  if (!base) return html;
  const tag = `<base href="${base}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + tag);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => m + tag);
  }
  return tag + html;
}

function render() {
  if (!current) return;
  const flags = [...SANDBOX_BASE];
  if (toggleScripts.checked) flags.push("allow-scripts");
  frame.setAttribute("sandbox", flags.join(" "));
  // Reassign srcdoc to force a fresh load (e.g. after toggling scripts).
  frame.srcdoc = injectBase(current.html, current.rawBase);
}

async function load() {
  const { preview } = await chrome.storage.session.get("preview");
  if (!preview) {
    srcEl.textContent = "プレビューするデータがありません。GitHub の HTML ファイルで「Preview HTML」を押すか、ポップアップから貼り付けてください。";
    return;
  }
  current = preview;
  srcEl.textContent = preview.sourceUrl || "(pasted HTML)";
  const name = (preview.sourceUrl || "").split("/").pop() || "HTML";
  document.title = `Preview – ${name}`;
  render();
}

reloadBtn.addEventListener("click", render);
toggleScripts.addEventListener("change", render);
load();
