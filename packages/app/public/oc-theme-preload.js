;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "oc-2"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
  }

  // mindscript_change: an embedding host (the VS Code extension's webview) can pass its
  // own current theme explicitly via ?vscode_theme=dark|light, so this app matches the
  // host's ACTUAL theme instead of guessing from the OS-level prefers-color-scheme media
  // query — those two easily disagree (e.g. macOS set to Light Mode, VS Code set to a dark
  // theme), which previously showed a jarring white panel inside an otherwise dark editor.
  // mindscript_change: the same host can ask for a display scale via ?zoom=. The panel shows
  // this UI beside VS Code's much denser chrome, where the reading size that suits a full
  // browser window looks oversized and airy. Scaling the root shrinks type and spacing together
  // - scaling only the font would leave the padding behind and look worse. Applied here, before
  // first paint, so the panel never flashes at the wrong size. Only an embedding host passes
  // this, so the browser and desktop apps are unaffected.
  var requestedZoom = parseFloat(new URLSearchParams(location.search).get("zoom") || "")
  if (isFinite(requestedZoom) && requestedZoom > 0) {
    var scale = Math.min(1.5, Math.max(0.5, requestedZoom))
    // A rule on body, not documentElement.style.zoom: Chromium ignores zoom on the root element
    // (measured - the property was set and layout did not change), and a rule applies at parse
    // time so it lands before first paint even though <body> does not exist yet.
    var zoomStyle = document.createElement("style")
    zoomStyle.id = "oc-host-zoom"
    zoomStyle.textContent = "body{zoom:" + scale + "}"
    document.head.appendChild(zoomStyle)
  }

  var hostTheme = new URLSearchParams(location.search).get("vscode_theme")
  var scheme =
    hostTheme === "dark" || hostTheme === "light" ? hostTheme : localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

  if (themeId === "oc-2") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
