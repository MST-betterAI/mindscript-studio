import { describe, expect, test } from "bun:test"
import { describePreviewUrls, detectPreviewUrls } from "../../src/tool/preview-url"

const ESC = "\u001b"

describe("detectPreviewUrls", () => {
  test("finds the address a dev server prints", () => {
    expect(detectPreviewUrls("VITE ready\n  Local:   http://localhost:5173/")).toEqual(["http://localhost:5173/"])
    expect(detectPreviewUrls("Listening on http://127.0.0.1:3000")).toEqual(["http://127.0.0.1:3000/"])
  })

  test("sees through the colour codes dev servers wrap it in", () => {
    const coloured = `  ${ESC}[32mLocal:${ESC}[39m   ${ESC}[36mhttp://localhost:5173/${ESC}[39m`
    expect(detectPreviewUrls(coloured)).toEqual(["http://localhost:5173/"])
  })

  test("rewrites the addresses a browser cannot open", () => {
    // 0.0.0.0 means every interface; a person needs the loopback address.
    expect(detectPreviewUrls("Server running at http://0.0.0.0:8080/")).toEqual(["http://127.0.0.1:8080/"])
  })

  test("drops sentence punctuation that is not part of the address", () => {
    expect(detectPreviewUrls("open http://localhost:4398.")).toEqual(["http://localhost:4398/"])
  })

  test("ignores things nobody means to open", () => {
    expect(detectPreviewUrls("probing http://127.0.0.1:3000/healthz")).toEqual([])
    expect(detectPreviewUrls("GET http://localhost:3000/favicon.ico 200")).toEqual([])
    // no port is a hostname, not a running dev server
    expect(detectPreviewUrls("see http://localhost/docs")).toEqual([])
  })

  test("ignores remote addresses entirely", () => {
    expect(detectPreviewUrls("fetching https://example.com:443/thing")).toEqual([])
  })

  test("reports each address once, in the order printed, and caps the noise", () => {
    const text = [
      "http://localhost:3000/",
      "http://localhost:3000/",
      "http://localhost:4000/",
      "http://localhost:5000/",
      "http://localhost:6000/",
    ].join("\n")
    expect(detectPreviewUrls(text)).toEqual([
      "http://localhost:3000/",
      "http://localhost:4000/",
      "http://localhost:5000/",
    ])
  })

  test("says nothing about ordinary output", () => {
    expect(detectPreviewUrls("npm warn deprecated foo@1.0.0")).toEqual([])
    expect(detectPreviewUrls("")).toEqual([])
  })
})

describe("describePreviewUrls", () => {
  test("stays silent when there is nothing to report", () => {
    expect(describePreviewUrls([])).toBeUndefined()
  })

  test("names one address, and more than one", () => {
    expect(describePreviewUrls(["http://localhost:3000/"])).toContain("http://localhost:3000/")
    const many = describePreviewUrls(["http://localhost:3000/", "http://localhost:4000/"])
    expect(many).toContain("http://localhost:3000/")
    expect(many).toContain("http://localhost:4000/")
  })
})
