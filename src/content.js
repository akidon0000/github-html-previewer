// Injected on github.com. On a blob view of an .html / .htm file we add two
// segments next to GitHub's "Code" / "Blame" toggle:
//
//   Preview(inline)     – render the HTML in place of the code listing
//   Preview(other tab)  – open the rendered HTML in a new tab
//
// Both render through the extension's preview controller (preview.html), which
// embeds a sandboxed page with a permissive CSP — so the previewed page's
// scripts (e.g. Mermaid) run. Inline embeds that controller as an iframe right
// in the page (a web-accessible resource, so github.com's CSP doesn't block it).
//
// GitHub's blob page is a React app with obfuscated, churn-prone class names, so
// we anchor off the "Blame" control and clone its segment to inherit styling.
// If the toggle can't be found we fall back to floating buttons.

(function () {
  const INLINE_ID = "ghhp-preview-inline";
  const OTHERTAB_ID = "ghhp-preview-othertab";
  const FRAME_ID = "ghhp-preview-frame";
  const FLOAT_ID = "ghhp-float";

  let inlineActive = false;
  let hiddenRegion = null;
  let frameEl = null;
  let prevActive = null; // { el, value } native segment we deselected for inline

  // ---- helpers ---------------------------------------------------------------

  function htmlBlobInfo() {
    // ["", OWNER, REPO, ("blob"|"blame"), BRANCH, ...path]
    // Match the Blame view too, so our buttons stay visible there.
    const parts = location.pathname.split("/");
    if ((parts[3] !== "blob" && parts[3] !== "blame") || parts.length < 6) return null;
    const file = parts[parts.length - 1];
    if (!/\.html?$/i.test(file)) return null;

    const owner = parts[1];
    const repo = parts[2];
    const branch = parts[4];
    const pathParts = parts.slice(5);
    const path = pathParts.join("/");
    const dir = pathParts.slice(0, -1).join("/");
    return {
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
      rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dir ? dir + "/" : ""}`
    };
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp);
        });
      } catch (e) {
        // e.g. "Extension context invalidated" after the extension reloads.
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  // GitHub keeps the file's raw source in this textarea, so we read it straight
  // from the page (no network; works for private repos).
  function readDomSource() {
    const ta = document.querySelector("#read-only-cursor-text-area");
    if (ta && typeof ta.value === "string" && ta.value.length > 0) return ta.value;
    return null;
  }

  function findCodeRegion() {
    const selectors = [
      ".react-code-file-contents",
      '[data-testid="code-content"]',
      ".react-blob-print-hide",
      ".blob-wrapper",
      ".highlight.tab-size"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const ta = document.querySelector("#read-only-cursor-text-area");
    if (ta) {
      let el = ta;
      for (let i = 0; i < 4 && el.parentElement; i++) el = el.parentElement;
      return el;
    }
    return null;
  }

  // The link in the toggle that points to a given pathname (used to anchor on the
  // Code/Blame control reliably on both the blob and blame views).
  function anchorToPath(pathname) {
    for (const a of document.querySelectorAll("a[href]")) {
      try {
        if (new URL(a.getAttribute("href"), location.origin).pathname === pathname) return a;
      } catch (_e) {
        /* ignore malformed href */
      }
    }
    return null;
  }

  function findToggle() {
    // The Code/Blame control always links to the *other* view of this file
    // (Blame link on a blob page, Code link on a blame page). That link is a
    // unique, reliable anchor — unlike breadcrumb links which point elsewhere.
    const isBlame = location.pathname.split("/")[3] === "blame";
    const otherPath = isBlame
      ? location.pathname.replace("/blame/", "/blob/")
      : location.pathname.replace("/blob/", "/blame/");

    let anchor = anchorToPath(otherPath);
    if (!anchor) {
      const candidates = document.querySelectorAll(
        '[class*="SegmentedControl"] a, [class*="SegmentedControl"] button, nav a, nav button'
      );
      for (const el of candidates) {
        const t = el.textContent.trim();
        if (t === "Blame" || t === "Code") {
          anchor = el;
          break;
        }
      }
    }
    if (!anchor) return null;
    const container =
      anchor.closest("ul") ||
      anchor.closest('[class*="SegmentedControl"]') ||
      (anchor.parentElement && anchor.parentElement.parentElement) ||
      anchor.parentElement;
    if (!container) return null;
    let item = anchor;
    while (item.parentElement && item.parentElement !== container) item = item.parentElement;
    return { container, item };
  }

  function setSegmentLabel(node, text) {
    node.querySelectorAll("[data-text]").forEach((e) => e.setAttribute("data-text", text));
    const leaves = node.querySelectorAll('[data-component="text"], [class*="Text"], span');
    for (const leaf of leaves) {
      if (leaf.children.length === 0 && leaf.textContent.trim()) {
        leaf.textContent = text;
        return;
      }
    }
    node.textContent = text;
  }

  function clickableOf(node) {
    return node.querySelector("a, button") || node;
  }

  function markActive(node, active) {
    if (!node) return;
    const btn = clickableOf(node);
    if (active) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  }

  // Move the segmented-control selection onto our Preview segment: deselect the
  // currently-active native segment (Code/Blame) and remember it so we can
  // restore it when the preview is closed.
  function selectPreviewSegment(btn) {
    prevActive = null;
    const container = btn.parentElement;
    if (container) {
      for (const seg of container.children) {
        if (seg === btn) continue;
        const c = clickableOf(seg);
        const cur = c.getAttribute("aria-current");
        if (cur) {
          prevActive = { el: c, value: cur };
          c.removeAttribute("aria-current");
        }
      }
    }
    markActive(btn, true);
  }

  function restoreSelection() {
    if (prevActive) {
      prevActive.el.setAttribute("aria-current", prevActive.value);
      prevActive = null;
    }
  }

  // ---- preview actions -------------------------------------------------------

  // Get the file's HTML: straight from the page DOM (works for private repos),
  // else via the service worker fetching the public raw file.
  async function getHtml(info) {
    const dom = readDomSource();
    if (dom != null) return { ok: true, html: dom };
    return sendMessage({ type: "FETCH_RAW", rawUrl: info.rawUrl });
  }

  async function openOtherTab(info, btn) {
    try {
      const html = readDomSource(); // null -> background fetches the public raw file
      setSegmentLabel(btn, "⏳ …");
      const resp = await sendMessage({
        type: "OPEN_PREVIEW",
        html,
        rawUrl: info.rawUrl,
        rawBase: info.rawBase,
        sourceUrl: location.href
      });
      setSegmentLabel(btn, "Preview(other tab)");
      if (!resp?.ok) alert("HTML の取得に失敗しました: " + (resp?.error || "unknown error"));
    } catch (e) {
      setSegmentLabel(btn, "Preview(other tab)");
      alert("プレビューに失敗しました: " + String(e));
    }
  }

  async function activateInline(info, btn) {
    try {
      const region = findCodeRegion();
      if (!region) {
        alert("プレビューを表示する領域が見つかりませんでした（GitHub の DOM 変更の可能性があります）。");
        return;
      }
      setSegmentLabel(btn, "⏳ …");
      const got = await getHtml(info);
      setSegmentLabel(btn, "Preview(inline)");
      if (!got.ok) {
        alert("HTML の取得に失敗しました: " + (got.error || "unknown error"));
        return;
      }

      // Embed the sandboxed renderer directly (one level), and hand it the HTML
      // via postMessage once it has loaded. The sandbox page is a web-accessible
      // resource with a permissive CSP, so it renders (and runs scripts) freely.
      frameEl = document.createElement("iframe");
      frameEl.id = FRAME_ID;
      frameEl.src = chrome.runtime.getURL("src/preview-sandbox.html");
      // Height is auto-fit to the content (see the ghhp-height handler), so the
      // inner scrollbar is redundant — the GitHub page scrolls the whole preview.
      frameEl.setAttribute("scrolling", "no");
      Object.assign(frameEl.style, {
        width: "100%",
        height: "80vh",
        border: "1px solid #30363d",
        borderRadius: "6px",
        background: "#fff",
        overflow: "hidden"
      });
      frameEl.addEventListener("load", () => {
        frameEl.contentWindow.postMessage(
          { type: "ghhp-render", html: got.html, rawBase: info.rawBase, allowScripts: true },
          "*"
        );
      });
      hiddenRegion = region;
      region.style.display = "none";
      region.parentElement.insertBefore(frameEl, region.nextSibling);
      inlineActive = true;
      selectPreviewSegment(btn);
    } catch (e) {
      setSegmentLabel(btn, "Preview(inline)");
      alert("プレビューに失敗しました: " + String(e));
    }
  }

  function deactivateInline(btn) {
    frameEl?.remove();
    frameEl = null;
    if (hiddenRegion) hiddenRegion.style.display = "";
    hiddenRegion = null;
    inlineActive = false;
    markActive(btn || document.getElementById(INLINE_ID), false);
    restoreSelection();
  }

  function toggleInline(info, btn) {
    if (inlineActive) deactivateInline(btn);
    else activateInline(info, btn);
  }

  // The inline sandbox reports its content height; size the iframe to fit so the
  // GitHub page scrolls the whole preview naturally (no inner scrollbar). Updates
  // as images / Mermaid change the layout.
  window.addEventListener("message", (e) => {
    if (!frameEl || e.source !== frameEl.contentWindow) return;
    const d = e.data;
    if (d?.type !== "ghhp-height" || typeof d.height !== "number") return;
    const h = Math.max(200, Math.min(d.height, 40000));
    const cur = parseFloat(frameEl.style.height) || 0;
    if (Math.abs(cur - h) > 8) frameEl.style.height = h + "px";
  });

  // ---- UI injection ----------------------------------------------------------

  function buildSegment(template, id, label, onClick) {
    const seg = template.cloneNode(true);
    seg.id = id;
    seg.querySelectorAll("[aria-current]").forEach((e) => e.removeAttribute("aria-current"));
    seg.querySelectorAll("a[href]").forEach((a) => a.removeAttribute("href"));
    seg.querySelectorAll("a").forEach((a) => {
      a.setAttribute("role", "button");
      a.setAttribute("tabindex", "0");
    });
    setSegmentLabel(seg, label);
    const clickable = clickableOf(seg);
    clickable.style.cursor = "pointer";
    const handler = (e) => {
      e.preventDefault();
      onClick(seg);
    };
    clickable.addEventListener("click", handler);
    clickable.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") handler(e);
    });
    return seg;
  }

  function insertSegments(info) {
    if (document.getElementById(INLINE_ID)) return true;
    const toggle = findToggle();
    if (!toggle) return false;

    const inlineSeg = buildSegment(toggle.item, INLINE_ID, "Preview(inline)", (seg) =>
      toggleInline(info, seg)
    );
    const otherSeg = buildSegment(toggle.item, OTHERTAB_ID, "Preview(other tab)", (seg) =>
      openOtherTab(info, seg)
    );

    // Native Code/Blame returns to the normal view.
    for (const sib of toggle.container.children) {
      sib.addEventListener("click", () => {
        if (inlineActive) deactivateInline();
      });
    }

    toggle.container.appendChild(inlineSeg);
    toggle.container.appendChild(otherSeg);
    return true;
  }

  function insertFloating(info) {
    if (document.getElementById(FLOAT_ID)) return;
    const wrap = document.createElement("div");
    wrap.id = FLOAT_ID;
    Object.assign(wrap.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "9999",
      display: "flex",
      gap: "8px"
    });
    const mk = (label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      Object.assign(b.style, {
        padding: "10px 14px",
        fontSize: "13px",
        fontWeight: "600",
        color: "#fff",
        background: "#1f6feb",
        border: "none",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        cursor: "pointer"
      });
      b.addEventListener("click", () => onClick(b));
      return b;
    };
    wrap.appendChild(mk("Preview(inline)", (b) => toggleInline(info, b)));
    wrap.appendChild(mk("Preview(other tab)", (b) => openOtherTab(info, b)));
    document.body.appendChild(wrap);
  }

  function teardown() {
    if (inlineActive) deactivateInline();
    document.getElementById(INLINE_ID)?.remove();
    document.getElementById(OTHERTAB_ID)?.remove();
    document.getElementById(FLOAT_ID)?.remove();
  }

  function ensureUI() {
    const info = htmlBlobInfo();
    if (!info) {
      teardown();
      return;
    }
    if (inlineActive && !document.getElementById(FRAME_ID)) {
      // React wiped our frame; reset state so the toggle works again.
      inlineActive = false;
      hiddenRegion = null;
      frameEl = null;
    }
    if (insertSegments(info)) {
      document.getElementById(FLOAT_ID)?.remove(); // drop the fallback if it was shown
    } else {
      insertFloating(info);
    }
  }

  // ---- react to GitHub's SPA navigation & async rendering --------------------
  //
  // We deliberately do NOT use a document-wide MutationObserver: GitHub re-renders
  // the blob view constantly, and observing the whole subtree made the page crawl.
  // Instead we run a short burst of checks after load/navigation (to catch the
  // toolbar rendering in), plus a cheap low-frequency interval as a safety net
  // (re-adds our buttons if React removed them, and catches missed navigations).

  function safeEnsureUI() {
    try {
      ensureUI();
    } catch (_e) {
      /* ignore transient DOM errors during GitHub's re-renders */
    }
  }

  function ensureSoon() {
    [0, 200, 500, 1000, 1800].forEach((d) => setTimeout(safeEnsureUI, d));
  }

  // On navigation, drop the old buttons (they captured the previous file's info)
  // and re-inject for the new page.
  function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    try {
      teardown();
    } catch (_e) {
      /* ignore */
    }
    ensureSoon();
  }

  let lastUrl = location.href;

  const origPush = history.pushState;
  history.pushState = function (...args) {
    const ret = origPush.apply(this, args);
    handleUrlChange();
    return ret;
  };
  window.addEventListener("popstate", handleUrlChange);

  // Safety net: cheap re-check ~ once per second (re-adds buttons if React
  // removed them, and catches soft navigations the history hook didn't see).
  setInterval(() => {
    handleUrlChange();
    safeEnsureUI();
  }, 1000);

  ensureSoon();
})();
