import { authTokenFromCredentials } from "@/utils/server"
import { DEFAULT_ROUTING_PRIORITIES, type RoutingPriorities } from "./routing-preferences"

/** Shape of /mindscript/preferences (packages/opencode: httpapi/groups/mindscript.ts). */
export interface RemotePreferences {
  configured: boolean
  reachable: boolean
  intelligence: number
  speed: number
  cost: number
  disabledModels: string[]
  error?: string
}

type Http = { url: string; username?: string; password?: string }
type Fetcher = typeof fetch

function headersFor(http: Http, json: boolean) {
  const headers: Record<string, string> = {}
  if (http.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`
  }
  if (json) headers["content-type"] = "application/json"
  return headers
}

export async function loadPreferences(http: Http, doFetch: Fetcher): Promise<RemotePreferences | undefined> {
  const response = await doFetch(new URL("/mindscript/preferences", http.url).toString(), {
    headers: headersFor(http, false),
  })
  if (!response.ok) return
  return (await response.json()) as RemotePreferences
}

export async function savePreferences(
  http: Http,
  doFetch: Fetcher,
  update: Partial<RoutingPriorities> & { disabledModels?: string[] },
): Promise<RemotePreferences | undefined> {
  const response = await doFetch(new URL("/mindscript/preferences", http.url).toString(), {
    method: "POST",
    headers: headersFor(http, true),
    body: JSON.stringify(update),
  })
  if (!response.ok) return
  return (await response.json()) as RemotePreferences
}

/** Auto means "I have not set a balance myself", which is exactly the engine defaults. */
export function isAutoBalance(priorities: RoutingPriorities) {
  const close = (a: number, b: number) => Math.abs(a - b) < 0.005
  return (
    close(priorities.intelligence, DEFAULT_ROUTING_PRIORITIES.intelligence) &&
    close(priorities.speed, DEFAULT_ROUTING_PRIORITIES.speed) &&
    close(priorities.cost, DEFAULT_ROUTING_PRIORITIES.cost)
  )
}
