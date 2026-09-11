// mindscript_change: account-wide numbers from the MindScript engine, proxied by the
// Studio server so the engine API key never reaches a browser, webview or renderer.
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

export const MindScriptModelUsage = Schema.Struct({
  id: Schema.String,
  requests: Schema.Number,
  costUSD: Schema.Number,
}).annotate({ identifier: "MindScriptModelUsage" })

export const MindScriptUsage = Schema.Struct({
  /** An engine API key is available to this server. */
  configured: Schema.Boolean,
  /** The engine answered the usage query. */
  reachable: Schema.Boolean,
  baseURL: Schema.String,
  since: Schema.optional(Schema.String),
  requests: Schema.Number,
  /** What the account paid. */
  costUSD: Schema.Number,
  /** What always using the premium model would have cost, minus what was paid. */
  savingsUSD: Schema.Number,
  premiumBaseline: Schema.optional(Schema.String),
  models: Schema.Array(MindScriptModelUsage),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "MindScriptUsage" })

export const MindScriptUsageQuery = Schema.Struct({
  /** ISO date, epoch seconds or epoch milliseconds; omitted = all time. */
  since: Schema.optional(Schema.String),
})

export const MindScriptPaths = {
  usage: "/mindscript/usage",
} as const

export const MindScriptApi = HttpApi.make("mindscript").add(
  HttpApiGroup.make("mindscript")
    .add(
      HttpApiEndpoint.get("usage", MindScriptPaths.usage, {
        query: MindScriptUsageQuery,
        success: described(MindScriptUsage, "MindScript usage roll-up for this account"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mindscript.usage",
          summary: "Get MindScript usage",
          description:
            "Requests, cost and savings versus always using the premium model for the account behind this server's MindScript key, optionally since a point in time.",
        }),
      ),
    )
    .middleware(Authorization),
)
