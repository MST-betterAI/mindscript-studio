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

/** Routing preferences live on the engine, per account, so every surface that talks to
 *  the same engine key sees the same settings instead of a per-browser copy. */
export const MindScriptPreferences = Schema.Struct({
  configured: Schema.Boolean,
  reachable: Schema.Boolean,
  /** Relative pull of each axis; the engine normalises them, they need not total 1. */
  intelligence: Schema.Number,
  speed: Schema.Number,
  cost: Schema.Number,
  /** Model ids auto routing must skip. */
  disabledModels: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "MindScriptPreferences" })

export const MindScriptPreferencesUpdate = Schema.Struct({
  intelligence: Schema.optional(Schema.Number),
  speed: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  disabledModels: Schema.optional(Schema.Array(Schema.String)),
})

export const MindScriptPaths = {
  usage: "/mindscript/usage",
  preferences: "/mindscript/preferences",
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
    .add(
      HttpApiEndpoint.get("preferences", MindScriptPaths.preferences, {
        success: described(MindScriptPreferences, "Routing preferences for this account"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mindscript.preferences",
          summary: "Get routing preferences",
          description: "The account's intelligence/speed/cost balance and the models auto routing must skip.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("setPreferences", MindScriptPaths.preferences, {
        payload: MindScriptPreferencesUpdate,
        success: described(MindScriptPreferences, "Routing preferences after the update"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mindscript.setPreferences",
          summary: "Set routing preferences",
          description: "Updates the account's routing balance and disabled models on the engine.",
        }),
      ),
    )
    .middleware(Authorization),
)
