// Runs inside the sandboxed extension page (permissive CSP: inline / eval /
// external https scripts allowed). The controller posts the HTML here; we render
// it by rewriting this document with document.write — which executes the page's
// inline and external scripts (e.g. Mermaid), unlike innerHTML/srcdoc-in-a-
// strict-CSP-page. The page's own scripts run under this page's permissive CSP.

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

// Appended to the rendered document so the page reports its content height back
// to the embedder (used by inline mode to size the iframe to fit the content,
// updating as images / Mermaid / etc. change the layout). Harmless when the
// embedder ignores it (e.g. the other-tab controller).
const HEIGHT_REPORTER =
  "<script>(function(){" +
  "function r(){try{var h=Math.max(" +
  "document.documentElement?document.documentElement.scrollHeight:0," +
  "document.body?document.body.scrollHeight:0);" +
  'parent.postMessage({type:"ghhp-height",height:h},"*");}catch(e){}}' +
  'window.addEventListener("load",r);window.addEventListener("resize",r);' +
  "try{new ResizeObserver(r).observe(document.documentElement);}catch(e){}" +
  "setTimeout(r,0);setTimeout(r,500);setTimeout(r,1500);" +
  "})();<\/script>";

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type !== "ghhp-render") return;
  const body = data.allowScripts ? data.html : stripScripts(data.html);
  document.open();
  document.write(injectBase(body, data.rawBase) + HEIGHT_REPORTER);
  document.close();
});
