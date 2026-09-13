import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ServerAuth } from "../../src/server/auth"
import { authorizationRouterMiddleware } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { serveEmbeddedUIEffect, serveUIEffect } from "../../src/server/shared/ui"
import { testEffect } from "../lib/effect"

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
      OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
      envPassword: process.env.OPENCODE_SERVER_PASSWORD,
      envUsername: process.env.OPENCODE_SERVER_USERNAME,
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
        Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
        restoreEnv("OPENCODE_SERVER_PASSWORD", original.envPassword)
        restoreEnv("OPENCODE_SERVER_USERNAME", original.envUsername)
      }),
    )
  }),
)

const fsUtilLayer = AppNodeBuilder.build(FSUtil.node)
const it = testEffect(Layer.mergeAll(testStateLayer, fsUtilLayer, RuntimeFlags.layer()))

function authConfigLayer(input?: { password?: string; username?: string }) {
  return ServerAuth.Config.configLayer({
    password: input?.password === undefined ? Option.none() : Option.some(input.password),
    username: input?.username ?? "opencode",
  })
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input?.password,
            OPENCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function uiApp(input?: {
  password?: string
  username?: string
  client?: Layer.Layer<HttpClient.HttpClient>
  disableEmbeddedWebUi?: boolean
}) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const flags = yield* RuntimeFlags.Service
        yield* router.add("*", "/*", (request) =>
          serveUIEffect(request, { fs, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
        )
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(authConfigLayer(input)))),
      Layer.provide([
        fsUtilLayer,
        input?.client ?? httpClient(new Response("ui")),
        RuntimeFlags.layer({ disableEmbeddedWebUi: input?.disableEmbeddedWebUi ?? false }),
        HttpServer.layerServices,
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function routeOrderingApp() {
  let proxiedUrl: string | undefined
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const flags = yield* RuntimeFlags.Service
        yield* router.add("GET", "/session/:sessionID", () =>
          Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })),
        )
        yield* router.add("*", "/*", (request) =>
          serveUIEffect(request, { fs, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
        )
      }),
    ).pipe(
      Layer.provide([
        fsUtilLayer,
        RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
        httpClient(new Response("ui"), (request) => {
          proxiedUrl = request.url
        }),
        HttpServer.layerServices,
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    proxiedUrl: () => proxiedUrl,
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function httpClient(response: Response, onRequest?: (request: HttpClientRequest.HttpClientRequest) => void) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      onRequest?.(request)
      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )
}

function responseText(response: Response) {
  return Effect.promise(() => response.text())
}

describe("HttpApi UI fallback", () => {
  // mindscript_change: upstream proxied the UI from app.opencode.ai whenever the embedded
  // bundle was absent, forwarding the caller's headers (Authorization included) to a host we
  // do not control. These tests replace the old proxy assertions and exist to keep it gone.
  it.live("reports the UI as unavailable instead of proxying it from upstream", () =>
    Effect.gen(function* () {
      let requested: string | undefined

      const response = yield* uiApp({
        disableEmbeddedWebUi: true,
        client: httpClient(new Response("should never be fetched"), (request) => {
          requested = request.url
        }),
      }).request("/")

      expect(requested).toBeUndefined()
      expect(response.status).toBe(503)
      expect(yield* responseText(response)).toContain("not available in this build")
    }),
  )

  it.live("never reaches the network for an asset path either", () =>
    Effect.gen(function* () {
      let requested: string | undefined

      const response = yield* Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const flags = yield* RuntimeFlags.Service
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/assets/app.js")), {
          fs,
          disableEmbeddedWebUi: flags.disableEmbeddedWebUi,
        })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                requested = request.url
                return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("nope")))
              }),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(requested).toBeUndefined()
      expect(response.status).toBe(503)
    }),
  )

  it.live("carries a content security policy on the unavailable response", () =>
    Effect.gen(function* () {
      const response = yield* Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const flags = yield* RuntimeFlags.Service
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/")), {
          fs,
          disableEmbeddedWebUi: flags.disableEmbeddedWebUi,
        })
      }).pipe(
        Effect.provide(RuntimeFlags.layer({ disableEmbeddedWebUi: true })),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(503)
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'")
    }),
  )

  it.live("serves embedded UI assets when Bun can read them but access reports missing", () =>
    Effect.gen(function* () {
      let readPath: string | undefined

      const fs = yield* FSUtil.Service
      const response = yield* serveEmbeddedUIEffect(
        "/assets/app.js",
        {
          ...fs,
          existsSafe: () => Effect.die("embedded UI should not rely on filesystem access checks"),
          readFile: (path) => {
            readPath = path
            return path === "/$bunfs/root/assets/app.js"
              ? Effect.succeed(new TextEncoder().encode("console.log('embedded')"))
              : Effect.die(`unexpected embedded UI path: ${path}`)
          },
        },
        { "assets/app.js": "/$bunfs/root/assets/app.js" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      expect(response.status).toBe(200)
      expect(readPath).toBe("/$bunfs/root/assets/app.js")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('embedded')")
    }),
  )

  it.live("allows embedded UI terminal wasm, blob attachments, and theme preload CSP", () =>
    Effect.gen(function* () {
      const script = 'document.documentElement.dataset.theme = "dark"'

      const fs = yield* FSUtil.Service
      const response = yield* serveEmbeddedUIEffect(
        "/",
        {
          ...fs,
          readFile: (path) => {
            return path === "/$bunfs/root/index.html"
              ? Effect.succeed(
                  new TextEncoder().encode(
                    `<html><head><script id="oc-theme-preload-script">${script}</script></head></html>`,
                  ),
                )
              : Effect.die(`unexpected embedded UI path: ${path}`)
          },
        },
        { "index.html": "/$bunfs/root/index.html" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      const csp = response.headers.get("content-security-policy") ?? ""
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
      expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`)
      expect(csp).toContain("img-src 'self' data: https: blob:")
      expect(csp).toContain("connect-src * data: blob:")
    }),
  )

  it.live("keeps matched API routes ahead of the UI fallback", () =>
    Effect.gen(function* () {
      const server = routeOrderingApp()
      const response = yield* server.request("/session/ses_nope")

      expect(response.status).toBe(404)
      expect(server.proxiedUrl()).toBeUndefined()
    }),
  )

  it.live("requires server password for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "opencode",
        disableEmbeddedWebUi: true,
      }).request("/")

      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
    }),
  )

  // These three assert that credentials are ACCEPTED. With no embedded UI in the test
  // build the route then answers 503; the point is that it is not the 401 above.
  it.live("accepts auth token for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "opencode",
        disableEmbeddedWebUi: true,
      }).request(`/?auth_token=${btoa("opencode:secret")}`)

      expect(response.status).not.toBe(401)
      expect(response.status).toBe(503)
    }),
  )

  it.live("accepts basic auth for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "opencode",
        disableEmbeddedWebUi: true,
      }).request("/", {
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      })

      expect(response.status).not.toBe(401)
      expect(response.status).toBe(503)
    }),
  )

  it.live("accepts basic auth passwords containing colons for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "sec:ret",
        username: "opencode",
        disableEmbeddedWebUi: true,
      }).request("/", {
        headers: { authorization: `Basic ${btoa("opencode:sec:ret")}` },
      })

      expect(response.status).not.toBe(401)
      expect(response.status).toBe(503)
    }),
  )

  // Regression for #25698 (Ope): the browser fetches the PWA manifest and
  // its icons via flows that don't carry app-managed credentials (the
  // `<link rel="manifest">` request is not under page-auth control), so the
  // server returning 401 breaks PWA install. These specific public assets
  // should bypass auth.
  it.live("serves the PWA manifest without auth even when a server password is set", () =>
    Effect.gen(function* () {
      for (const path of ["/site.webmanifest", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]) {
        const response = yield* uiApp({
          password: "secret",
          username: "opencode",
          disableEmbeddedWebUi: true,
          client: httpClient(new Response("ok")),
        }).request(path)
        expect(response.status).not.toBe(401)
      }
    }),
  )

  // Regression: a page loaded via `?auth_token=` (the VS Code extension's
  // embedding scheme) gets that token on the initial document request, but
  // the browser's own subsequent <script src>/<link href> requests for the
  // app's bundle do not carry the parent page's query string. Without this,
  // the bundle itself 401s, the app never mounts, and #root stays empty
  // forever — reported as a blank white screen in the VS Code editor tab.
  it.live("serves the app bundle under /assets without auth even when a server password is set", () =>
    Effect.gen(function* () {
      for (const path of ["/assets/index-DmWHFJzO.js", "/assets/index-B41UoQba.css"]) {
        const response = yield* uiApp({
          password: "secret",
          username: "opencode",
          disableEmbeddedWebUi: true,
          client: httpClient(new Response("ok")),
        }).request(path)
        expect(response.status).not.toBe(401)
      }
    }),
  )

  it.live("allows web UI preflight without auth", () =>
    Effect.gen(function* () {
      const response = yield* app({ password: "secret", username: "opencode" }).request("/", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    }),
  )
})
