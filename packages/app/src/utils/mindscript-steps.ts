import type { Message, Part } from "@opencode-ai/sdk/v2/client"

// mindscript_change: what the MindScript engine did on every step of a session. Data comes
// from the gateway's `x_orchestrator` metadata, kept on step-finish parts. Shared between the
// Context tab's full breakdown and the composer's small "currently active model" indicator —
// single source of truth so the two never drift on what counts as a step or how a model name
// is classified/hidden.
export type MindScriptStep = {
  messageID: string
  model: string
  routed: string
  fingerprint: string
  cost: number
  savings: number
  baseline: number
}

export const SHOW_MODELS_KEY = "mindscript.showModelNames"

export function readShowModels(): boolean {
  try {
    return localStorage.getItem(SHOW_MODELS_KEY) !== "false"
  } catch {
    return true
  }
}

export function mindscriptSteps(messages: Message[], getParts: (id: string) => Part[]): MindScriptStep[] {
  const out: MindScriptStep[] = []
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const part of getParts(message.id)) {
      if (part.type !== "step-finish") continue
      const meta = (part as unknown as { metadata?: { mindscript?: Record<string, unknown> } }).metadata?.mindscript
      if (!meta) continue
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
      out.push({
        messageID: message.id,
        model: typeof meta.model === "string" ? meta.model : "?",
        routed: typeof meta.routed === "string" ? meta.routed : "?",
        fingerprint: typeof meta.fingerprint === "string" ? meta.fingerprint : "",
        cost: num(meta.effective_cost_usd),
        savings: num(meta.savings_vs_premium_usd),
        baseline: num(meta.premium_baseline_cost_usd),
      })
    }
  }
  return out
}

export function mindscriptModelTier(model: string): "premium" | "fast" | "standard" {
  return /fable|opus|gpt-6|astra/i.test(model) ? "premium" : /haiku|mini|flash|4\.1/i.test(model) ? "fast" : "standard"
}

export function mindscriptModelLabel(model: string, showModels: boolean): string {
  return showModels ? model : mindscriptModelTier(model)
}
