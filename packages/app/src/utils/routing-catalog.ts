export type PriceTier = "free" | "$" | "$$" | "$$$" | "$$$$"

export interface RoutableModel {
  id: string
  label: string
  provider: string
  /** USD per million input tokens. */
  input: number
  /** USD per million output tokens. */
  output: number
}

/**
 * Placeholder mirror of the gateway's routable catalogue so the setup screen has real
 * models and real relative prices to show. Replace with a live fetch when these controls
 * are connected to the gateway.
 */
export const ROUTABLE_MODELS: RoutableModel[] = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", provider: "Anthropic", input: 10, output: 50 },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "Anthropic", input: 5, output: 25 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "Anthropic", input: 2, output: 10 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "Anthropic", input: 1, output: 5 },
  { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "OpenAI", input: 10, output: 50 },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "OpenAI", input: 4, output: 20 },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "OpenAI", input: 2, output: 12 },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "OpenAI", input: 0.2, output: 1.2 },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "OpenAI", input: 2, output: 8 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "OpenAI", input: 0.4, output: 1.6 },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "Google", input: 2, output: 12 },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "Google", input: 0.75, output: 3.75 },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "Google", input: 0.3, output: 2.5 },
  { id: "grok-4.6", label: "Grok 4.6", provider: "xAI", input: 2, output: 6 },
  { id: "grok-4.5", label: "Grok 4.5", provider: "xAI", input: 2, output: 6 },
  { id: "grok-4.3", label: "Grok 4.3", provider: "xAI", input: 1.25, output: 2.5 },
]

/** Output tokens are a third of the blend: a typical reply is far shorter than its prompt. */
export function blendedPrice(model: Pick<RoutableModel, "input" | "output">) {
  return model.input + model.output / 3
}

export function priceTier(model: Pick<RoutableModel, "input" | "output">): PriceTier {
  const blended = blendedPrice(model)
  if (blended <= 0) return "free"
  if (blended <= 3) return "$"
  if (blended <= 8) return "$$"
  if (blended <= 20) return "$$$"
  return "$$$$"
}
