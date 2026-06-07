// Lets the user paste arbitrary HTML and preview it in the same local preview tab.

document.getElementById("go").addEventListener("click", async () => {
  const html = document.getElementById("html").value;
  if (!html.trim()) return;
  await chrome.storage.session.set({
    preview: { html, rawBase: "", sourceUrl: "(pasted HTML)", fetchedAt: Date.now() }
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/preview.html") });
  window.close();
});
