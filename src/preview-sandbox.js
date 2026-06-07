// Runs inside the sandboxed extension page (permissive CSP: inline / eval /
// external https scripts allowed). It receives the HTML from the controller and
// renders it into a nested iframe. That nested iframe inherits this page's
// permissive CSP, so the previewed page's scripts run — while staying isolated
// from the controller. The scripts toggle just adds/removes "allow-scripts".

function injectBase(html, base) {
  if (!base) return html;
  const tag = `<base href="${base}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
  return tag + html;
}

const content = document.getElementById("content");

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type !== "ghhp-render") return;

  const flags = ["allow-forms", "allow-popups", "allow-modals", "allow-popups-to-escape-sandbox"];
  if (data.allowScripts) flags.unshift("allow-scripts");
  content.setAttribute("sandbox", flags.join(" "));
  content.srcdoc = injectBase(data.html, data.rawBase);
});

// Tell the controller we're ready to receive the payload.
window.parent.postMessage({ type: "ghhp-sandbox-ready" }, "*");
