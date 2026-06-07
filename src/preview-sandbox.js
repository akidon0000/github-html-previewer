// Runs inside the sandboxed extension page (permissive CSP: inline / eval /
// external https scripts allowed). The controller posts the HTML here; we render
// it by rewriting this document with document.write — which executes the page's
// inline and external scripts (e.g. Mermaid), unlike innerHTML/srcdoc-in-a-
// strict-CSP-page. The page's own scripts run under this page's permissive CSP.
//
// We also inject a tiny height reporter so the embedder (inline mode) can grow
// the iframe to fit the content instead of using a fixed height.

function injectBase(html, base) {
  if (!base) return html;
  const tag = `<base href="${base}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
  return tag + html;
}

function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "");
}

// Posts the rendered content's height to the parent on load / resize / async
// growth (images, Mermaid, etc.), so the embedder can size the iframe.
const HEIGHT_REPORTER =
  "<script>(function(){" +
  "function H(){var d=document,b=d.body,e=d.documentElement;" +
  "return Math.max(e?e.scrollHeight:0,b?b.scrollHeight:0,e?e.offsetHeight:0,b?b.offsetHeight:0);}" +
  'function S(){try{parent.postMessage({type:"ghhp-height",height:H()},"*");}catch(_){}}' +
  'window.addEventListener("load",S);window.addEventListener("resize",S);' +
  "try{new ResizeObserver(S).observe(document.documentElement);}catch(_){}" +
  "[50,150,300,600,1000,2000,3500].forEach(function(d){setTimeout(S,d);});S();" +
  "})();<\/script>";

function withHeightReporter(html) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, HEIGHT_REPORTER + "</body>");
  return html + HEIGHT_REPORTER;
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type !== "ghhp-render") return;
  const body = data.allowScripts ? data.html : stripScripts(data.html);
  document.open();
  document.write(withHeightReporter(injectBase(body, data.rawBase)));
  document.close();
});
