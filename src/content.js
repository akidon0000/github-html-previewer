// Injected on github.com. On a blob view of an .html / .htm file we add a
// "Preview" segment next to GitHub's "Code" / "Blame" toggle. Activating it
// renders the file *in place of the code listing*, inside an embedded extension
// page (which lives outside github.com's CSP, so the HTML actually renders).
// Toggling it off — or clicking GitHub's Code/Blame — restores the code view.
//
// GitHub's blob page is a React app with obfuscated, frequently-changing class
// names, so we anchor everything off the "Blame" control and clone its segment
// to inherit styling. If the toggle can't be found we fall back to a floating
// button so the feature still works.

(function () {
  const TAB_ID = "ghhp-preview-tab";
  const FRAME_ID = "ghhp-preview-frame";
  const FLOAT_ID = "ghhp-float-btn";

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

  // Locate the Code/Blame toggle by anchoring on the "Blame" control. Returns
  // the container (segmented control), the Blame *segment item*, and the Blame
  // element itself.
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

    // Walk up to the direct child of the container that contains Blame.
    let item = blame;
    while (item.parentElement && item.parentElement !== container) {
      item = item.parentElement;
    }
    return { container, item };
  }

  function setSegmentLabel(node, text) {
    // Primer mirrors the label in data-text (used for the bold-when-active trick).
    const plain = text.replace(/^[^\w]+\s*/, "");
    node.querySelectorAll("[data-text]").forEach((e) => e.setAttribute("data-text", plain));
    // Replace the visible text in the deepest text-bearing leaf.
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

  // ---- preview lifecycle -----------------------------------------------------

  async function activatePreview(info, tab) {
    const region = findCodeRegion();
    if (!region) {
      alert("プレビューを表示する領域が見つかりませんでした（GitHub の DOM 変更の可能性があります）。");
      return;
    }

    setSegmentLabel(tab, "⏳ …");
    const resp = await sendMessage({ type: "FETCH_RAW", rawUrl: info.rawUrl, rawBase: info.rawBase });
    setSegmentLabel(tab, "🔍 Preview");
    if (!resp?.ok) {
      alert("HTML の取得に失敗しました: " + (resp?.error || "unknown error"));
      return;
    }

    frameEl = document.createElement("iframe");
    frameEl.id = FRAME_ID;
    // Embed the extension page (outside github.com's CSP) which renders the HTML.
    frameEl.src =
      chrome.runtime.getURL("src/preview-frame.html") + "#" + encodeURIComponent(resp.key);
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
    const toggle = findToggle();
    if (!toggle) return false;

    const tab = toggle.item.cloneNode(true); // inherit GitHub's segment styling
    tab.id = TAB_ID;
    tab.querySelectorAll("[aria-current]").forEach((e) => e.removeAttribute("aria-current"));
    tab.querySelectorAll("a[href]").forEach((a) => a.removeAttribute("href"));
    tab.querySelectorAll("a").forEach((a) => {
      a.setAttribute("role", "button");
      a.setAttribute("tabindex", "0");
    });
    setSegmentLabel(tab, "🔍 Preview");

    const clickable = clickableOf(tab);
    clickable.style.cursor = "pointer";
    const activate = (e) => {
      e.preventDefault();
      togglePreview(info, tab);
    };
    clickable.addEventListener("click", activate);
    clickable.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") activate(e);
    });

    // Clicking GitHub's own Code/Blame should drop back to the normal view.
    for (const sib of toggle.container.children) {
      sib.addEventListener("click", () => {
        if (previewActive) deactivatePreview(tab);
      });
    }

    toggle.container.appendChild(tab);
    return true;
  }

  // Fallback when the Code/Blame toggle can't be located.
  function insertFloatingButton(info) {
    if (document.getElementById(FLOAT_ID)) return;
    const btn = document.createElement("button");
    btn.id = FLOAT_ID;
    btn.type = "button";
    btn.textContent = "🔍 Preview";
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
    // If React wiped our frame out from under us, reset state so the toggle works.
    if (previewActive && !document.getElementById(FRAME_ID)) {
      previewActive = false;
      hiddenRegion = null;
      frameEl = null;
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

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true
  });

  ensureUI();
})();
