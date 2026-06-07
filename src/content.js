// Injected on github.com. On a blob view of an .html / .htm file we add a
// "Preview" tab next to GitHub's "Code" / "Blame" toggle. Activating it renders
// the file as a sandboxed iframe *in place of the code listing*; toggling it off
// (or clicking GitHub's Code/Blame) restores the original view.
//
// GitHub's blob page is a React app whose markup and (obfuscated) class names
// change often, so nothing here hard-codes a brittle class. We anchor off the
// "Blame" link, fall back through several selectors to find the code region, and
// if we can't find the toggle at all we drop a floating button instead so the
// feature still works.

(function () {
  const TAB_ID = "ghhp-preview-tab";
  const FRAME_ID = "ghhp-preview-frame";
  const FLOAT_ID = "ghhp-float-btn";

  /** rawUrl -> fetched HTML text */
  const cache = new Map();

  let previewActive = false;
  let hiddenRegion = null; // the code element we hid
  let frameEl = null;

  // ---- helpers ---------------------------------------------------------------

  function htmlBlobInfo() {
    // /OWNER/REPO/blob/BRANCH/dir/.../file.html
    const parts = location.pathname.split("/");
    if (parts[3] !== "blob" || parts.length < 6) return null;
    const file = parts[parts.length - 1];
    if (!/\.html?$/i.test(file)) return null;

    const [, owner, repo, , branch, ...pathParts] = parts;
    const path = pathParts.join("/");
    const dir = pathParts.slice(0, -1).join("/");
    return {
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
      rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dir ? dir + "/" : ""}`
    };
  }

  function injectBase(html, base) {
    if (!base) return html;
    const tag = `<base href="${base}">`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
    return tag + html;
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp);
        }
      });
    });
  }

  // The element holding the rendered code lines, which we hide while previewing.
  function findCodeRegion() {
    const selectors = [
      ".react-code-file-contents",
      '[data-testid="code-content"]',
      ".react-blob-print-hide",
      ".blob-wrapper", // legacy (non-React) blob view
      ".highlight.tab-size"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Last resort: climb up from the hidden code textarea to a sizeable block.
    const ta = document.querySelector("#read-only-cursor-text-area");
    if (ta) {
      let el = ta;
      for (let i = 0; i < 4 && el.parentElement; i++) el = el.parentElement;
      return el;
    }
    return null;
  }

  // The "Blame" link is the most stable anchor for the Code/Blame toggle.
  function findBlameLink() {
    return document.querySelector('a[href*="/blame/"]');
  }

  function setLabel(el, text) {
    const labelEl = el.querySelector('[data-component="text"]') || el;
    labelEl.textContent = text;
  }

  function markActive(tab, active) {
    if (!tab) return;
    tab.setAttribute("aria-pressed", String(active));
    tab.style.fontWeight = active ? "600" : "";
    tab.style.boxShadow = active ? "inset 0 -2px 0 0 #fd8c73" : "";
  }

  // ---- preview lifecycle -----------------------------------------------------

  async function activatePreview(info, tab) {
    const region = findCodeRegion();
    if (!region) {
      alert("プレビューを表示する領域が見つかりませんでした（GitHub の DOM 変更の可能性があります）。");
      return;
    }

    let html = cache.get(info.rawUrl);
    if (html == null) {
      setLabel(tab, "⏳ …");
      const resp = await sendMessage({ type: "FETCH_RAW", rawUrl: info.rawUrl });
      setLabel(tab, "🔍 Preview");
      if (!resp?.ok) {
        alert("取得に失敗しました: " + (resp?.error || "unknown error"));
        return;
      }
      html = resp.html;
      cache.set(info.rawUrl, html);
    }

    frameEl = document.createElement("iframe");
    frameEl.id = FRAME_ID;
    frameEl.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
    Object.assign(frameEl.style, {
      width: "100%",
      height: "80vh",
      border: "1px solid #30363d",
      borderRadius: "6px",
      background: "#fff"
    });
    frameEl.srcdoc = injectBase(html, info.rawBase);

    hiddenRegion = region;
    region.style.display = "none";
    region.parentElement.insertBefore(frameEl, region.nextSibling);

    previewActive = true;
    markActive(tab, true);
  }

  function deactivatePreview(tab) {
    frameEl?.remove();
    frameEl = null;
    if (hiddenRegion) hiddenRegion.style.display = "";
    hiddenRegion = null;
    previewActive = false;
    markActive(tab || document.getElementById(TAB_ID), false);
  }

  function togglePreview(info, tab) {
    if (previewActive) deactivatePreview(tab);
    else activatePreview(info, tab);
  }

  // ---- UI injection ----------------------------------------------------------

  function insertPreviewTab(info) {
    if (document.getElementById(TAB_ID)) return true;
    const blame = findBlameLink();
    if (!blame || !blame.parentElement) return false;

    const tab = blame.cloneNode(true); // inherit GitHub's segment styling
    tab.id = TAB_ID;
    tab.removeAttribute("href");
    tab.setAttribute("role", "button");
    tab.setAttribute("tabindex", "0");
    tab.setAttribute("aria-pressed", "false");
    tab.style.cursor = "pointer";
    setLabel(tab, "🔍 Preview");

    tab.addEventListener("click", (e) => {
      e.preventDefault();
      togglePreview(info, tab);
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        togglePreview(info, tab);
      }
    });

    // Clicking GitHub's own Code/Blame should drop back to the normal view.
    for (const sibling of blame.parentElement.children) {
      sibling.addEventListener("click", () => {
        if (previewActive) deactivatePreview(tab);
      });
    }

    blame.parentElement.appendChild(tab);
    return true;
  }

  // Fallback when the Code/Blame toggle can't be located: a floating button that
  // toggles the inline preview the same way.
  function insertFloatingButton(info) {
    if (document.getElementById(FLOAT_ID)) return;
    const btn = document.createElement("button");
    btn.id = FLOAT_ID;
    btn.type = "button";
    setLabel(btn, "🔍 Preview");
    Object.assign(btn.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "9999",
      padding: "10px 16px",
      fontSize: "13px",
      fontWeight: "600",
      color: "#fff",
      background: "#1f6feb",
      border: "none",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      cursor: "pointer"
    });
    btn.addEventListener("click", () => togglePreview(info, btn));
    document.body.appendChild(btn);
  }

  function teardown() {
    if (previewActive) deactivatePreview();
    document.getElementById(TAB_ID)?.remove();
    document.getElementById(FLOAT_ID)?.remove();
  }

  function ensureUI() {
    const info = htmlBlobInfo();
    if (!info) {
      teardown();
      return;
    }
    if (!insertPreviewTab(info)) insertFloatingButton(info);
  }

  // ---- react to GitHub's SPA navigation & async rendering --------------------

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureUI();
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
      teardown(); // reset state for the new page
    }
    schedule();
  }
  setInterval(handleNav, 800);

  // GitHub re-renders the toolbar asynchronously; re-insert if it gets wiped.
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true
  });

  ensureUI();
})();
