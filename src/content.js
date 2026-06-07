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

  // ---- helpers ---------------------------------------------------------------

  function htmlBlobInfo() {
    // ["", OWNER, REPO, "blob", BRANCH, ...path]
    const parts = location.pathname.split("/");
    if (parts[3] !== "blob" || parts.length < 6) return null;
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
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp);
      });
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

  function findToggle() {
    let blame = document.querySelector('a[href*="/blame/"]');
    if (!blame) {
      const candidates = document.querySelectorAll(
        '[class*="SegmentedControl"] a, [class*="SegmentedControl"] button, nav a, nav button'
      );
      for (const el of candidates) {
        if (el.textContent.trim() === "Blame") {
          blame = el;
          break;
        }
      }
    }
    if (!blame) return null;
    const container =
      blame.closest("ul") ||
      blame.closest('[class*="SegmentedControl"]') ||
      (blame.parentElement && blame.parentElement.parentElement) ||
      blame.parentElement;
    if (!container) return null;
    let item = blame;
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

  // ---- preview actions -------------------------------------------------------

  async function storeHtml(info, openTab) {
    const html = readDomSource(); // null -> background fetches the public raw file
    return sendMessage({
      type: "OPEN_PREVIEW",
      html,
      rawUrl: info.rawUrl,
      rawBase: info.rawBase,
      sourceUrl: location.href,
      openTab
    });
  }

  async function openOtherTab(info, btn) {
    setSegmentLabel(btn, "⏳ …");
    const resp = await storeHtml(info, true);
    setSegmentLabel(btn, "Preview(other tab)");
    if (!resp?.ok) alert("HTML の取得に失敗しました: " + (resp?.error || "unknown error"));
  }

  async function activateInline(info, btn) {
    const region = findCodeRegion();
    if (!region) {
      alert("プレビューを表示する領域が見つかりませんでした（GitHub の DOM 変更の可能性があります）。");
      return;
    }
    setSegmentLabel(btn, "⏳ …");
    const resp = await storeHtml(info, false);
    setSegmentLabel(btn, "Preview(inline)");
    if (!resp?.ok) {
      alert("HTML の取得に失敗しました: " + (resp?.error || "unknown error"));
      return;
    }

    frameEl = document.createElement("iframe");
    frameEl.id = FRAME_ID;
    // Web-accessible extension controller -> outside github.com's CSP.
    frameEl.src = chrome.runtime.getURL("src/preview.html");
    Object.assign(frameEl.style, {
      width: "100%",
      height: "80vh",
      border: "1px solid #30363d",
      borderRadius: "6px",
      background: "#fff"
    });
    hiddenRegion = region;
    region.style.display = "none";
    region.parentElement.insertBefore(frameEl, region.nextSibling);
    inlineActive = true;
    markActive(btn, true);
  }

  function deactivateInline(btn) {
    frameEl?.remove();
    frameEl = null;
    if (hiddenRegion) hiddenRegion.style.display = "";
    hiddenRegion = null;
    inlineActive = false;
    markActive(btn || document.getElementById(INLINE_ID), false);
  }

  function toggleInline(info, btn) {
    if (inlineActive) deactivateInline(btn);
    else activateInline(info, btn);
  }

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
    if (!insertSegments(info)) insertFloating(info);
  }

  // ---- react to GitHub's SPA navigation & async rendering --------------------

  function safeEnsureUI() {
    // GitHub re-renders the blob view constantly; swallow transient DOM errors
    // so they don't pile up in the extension's error log.
    try {
      ensureUI();
    } catch (_e) {
      /* ignore */
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      safeEnsureUI();
    });
  }

  const origPush = history.pushState;
  history.pushState = function (...args) {
    const ret = origPush.apply(this, args);
    handleNav();
    return ret;
  };
  window.addEventListener("popstate", handleNav);

  let lastUrl = location.href;
  function handleNav() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      teardown();
    }
    schedule();
  }
  setInterval(handleNav, 800);

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  safeEnsureUI();
})();
