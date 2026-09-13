import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount", () => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("opencode-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("an embedding host's ?vscode_theme=dark overrides OS/localStorage preference", () => {
    // No stored preference, and matchMedia (OS-level) says light — without the override this
    // would resolve to light, exactly the VS Code editor-tab bug (dark VS Code theme, light OS
    // appearance) that motivated this parameter.
    Object.defineProperty(window, "location", {
      value: { search: "?vscode_theme=dark" },
      configurable: true,
    })

    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.documentElement.style.backgroundColor).toBe("#080808")
  })

  test("an embedding host's ?vscode_theme=light overrides a stored dark preference", () => {
    localStorage.setItem("opencode-color-scheme", "dark")
    Object.defineProperty(window, "location", {
      value: { search: "?vscode_theme=light" },
      configurable: true,
    })

    run()

    expect(document.documentElement.dataset.colorScheme).toBe("light")
  })

  test("an invalid vscode_theme value falls back to the normal stored/OS logic", () => {
    localStorage.setItem("opencode-color-scheme", "dark")
    Object.defineProperty(window, "location", {
      value: { search: "?vscode_theme=purple" },
      configurable: true,
    })

    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
  })
})
