// MindScript Studio for VS Code: the Studio web UI, served by a local `mindscript serve`
// for this workspace, embedded in a sidebar view (and optionally an editor tab).
import * as vscode from "vscode"
import * as path from "node:path"
import { ServerManager, type ServerInfo } from "./server"
import { registerChatParticipant } from "./chat-participant"
import { parseSessionLink } from "./session-link"

/** How often to notice that the panel is holding a credential the server no longer accepts. */
const SERVER_WATCH_MS = 5_000

let manager: ServerManager | undefined
let out: vscode.OutputChannel | undefined
let editorPanel: vscode.WebviewPanel | undefined

function workspaceDirectory(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri
  const folders = vscode.workspace.workspaceFolders ?? []
  if (active) {
    const owner = vscode.workspace.getWorkspaceFolder(active)
    if (owner) return owner.uri.fsPath
  }
  return folders[0]?.uri.fsPath
}

// mindscript_change: the embedded Studio UI otherwise picks light/dark from the OS-level
// `prefers-color-scheme` media query, which can easily disagree with VS Code's own theme
// (e.g. macOS in Light Mode, VS Code in a dark theme) — reported as a jarring white panel
// inside an otherwise dark editor. `activeColorTheme.kind` is VS Code's own authoritative
// answer, passed through as `?vscode_theme=` (see oc-theme-preload.js's override check).
function vscodeThemeParam(): "dark" | "light" {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Dark:
    case vscode.ColorThemeKind.HighContrast:
      return "dark"
    default:
      return "light"
  }
}


// mindscript_change: the panel is the same web UI the desktop and browser show, and at their
// comfortable reading size it is too large and too airy beside VS Code's own dense chrome. A
// proportional scale shrinks type AND spacing together, which is what "make it denser" actually
// means; scaling only the font would leave the padding untouched and look worse. Passed as a
// parameter so ONLY the embedded panel is affected - the browser and desktop keep their own
// sizing - and exposed as a setting because the right density depends on the display.
function panelZoom(): number {
  const configured = vscode.workspace.getConfiguration("mindscript").get<number>("panelZoom")
  if (typeof configured !== "number" || !Number.isFinite(configured)) return 0.85
  // Clamp rather than trust: a zero or negative zoom renders an invisible panel, and a very
  // large one makes it unusable, with no obvious way back for someone who mistyped.
  return Math.min(1.5, Math.max(0.5, configured))
}

/** The web UI addresses a project by the base64url of its absolute path. */
function appUrl(info: ServerInfo, directory: string, route = "/session"): string {
  const dir = Buffer.from(directory).toString("base64url")
  const token = Buffer.from(`${info.username}:${info.password}`).toString("base64")
  return `${info.url}/${dir}${route}?auth_token=${encodeURIComponent(token)}&vscode_theme=${vscodeThemeParam()}&zoom=${panelZoom()}`
}

/** A message the extension pushes into the Studio UI (see packages/app: pages/session.tsx). */
type PromptAddMessage = {
  type: "mindscript.prompt.add"
  path: string
  selection?: { startLine: number; startChar: number; endLine: number; endChar: number }
  preview?: string
}

function html(webview: vscode.Webview, src: string | undefined, error?: string): string {
  const origin = src ? new URL(src).origin : ""
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const csp = `default-src 'none'; frame-src ${origin} http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;`
  // The host cannot post straight into a cross-origin iframe, so this page relays
  // messages from the extension into the Studio frame. Messages queue until the
  // Studio app reports it is listening ("mindscript.ready").
  const relay = src
    ? `<script nonce="${nonce}">(function(){
  var frame = document.getElementById("studio"), origin = ${JSON.stringify(origin)}, ready = false, queue = [];
  function flush(){ if(!ready||!frame||!frame.contentWindow) return; while(queue.length) frame.contentWindow.postMessage(queue.shift(), origin); }
  window.addEventListener("message", function(e){
    var m = e.data;
    if (frame && e.source === frame.contentWindow) { if (m && m.type === "mindscript.ready") { ready = true; flush(); } return; }
    if (m && m.type === "mindscript.prompt.add") { queue.push(m); flush(); }
  });
})();</script>`
    : ""
  const body = src
    ? `<iframe id="studio" src="${src.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" allow="clipboard-read; clipboard-write"></iframe>${relay}`
    : `<div class="msg"><h3>MindScript Studio</h3><p>${error ?? "Starting…"}</p><p>Open the <b>MindScript</b> output channel for details.</p></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--vscode-editor-background)}
iframe{border:0;width:100%;height:100%}
.msg{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;font-size:13px}</style></head>
<body>${body}</body></html>`
}

class StudioViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] }
    await this.render()
    view.onDidDispose(() => (this.view = undefined))
  }

  /** Push a message into the sidebar's Studio UI; false when the view is not open yet. */
  async post(message: PromptAddMessage): Promise<boolean> {
    if (!this.view) return false
    return this.view.webview.postMessage(message)
  }

  private rendered?: { url: string; username: string; password: string }
  private lastRoute = "/session"

  /** Resolve once the sidebar view exists (it is created lazily by VS Code after focus). */
  async waitForView(ms: number): Promise<boolean> {
    const until = Date.now() + ms
    while (!this.view && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
    return Boolean(this.view)
  }

  async render(route = "/session"): Promise<void> {
    const view = this.view
    if (!view) return
    const directory = workspaceDirectory()
    if (!directory) {
      view.webview.html = html(view.webview, undefined, "Open a folder first — Studio works per project.")
      return
    }
    view.webview.html = html(view.webview, undefined)
    try {
      const info = await manager!.ensure(directory)
      this.rendered = { url: info.url, username: info.username, password: info.password }
      this.lastRoute = route
      view.webview.html = html(view.webview, appUrl(info, directory, route))
    } catch (e) {
      this.rendered = undefined
      view.webview.html = html(view.webview, undefined, String(e instanceof Error ? e.message : e))
    }
  }

  // mindscript_change: the panel embeds the server's address AND a one-time credential, and a
  // fresh password is minted every time the server is spawned. So any restart underneath a
  // panel that is already open - a crash, a `Restart Server`, an upgrade - leaves that panel
  // holding a credential the server no longer accepts, showing nothing until the user happens to
  // reopen it. Nothing re-rendered on its own, because render() only ran on open or a command.
  //
  // Poll the credential we rendered with and re-render when it stops matching. Cheap (a local
  // registry read), and it recovers without the user having to know why the panel went blank.
  watchForServerChange(): vscode.Disposable {
    const timer = setInterval(() => {
      void (async () => {
        const current = this.rendered
        if (!current || !this.view?.visible) return
        const directory = workspaceDirectory()
        if (!directory) return
        const info = await manager?.peek(directory)
        if (!info) return
        const same =
          info.url === current.url && info.username === current.username && info.password === current.password
        if (!same) await this.render(this.lastRoute)
      })()
    }, SERVER_WATCH_MS)
    return new vscode.Disposable(() => clearInterval(timer))
  }
}

async function openInTab(context: vscode.ExtensionContext): Promise<void> {
  const directory = workspaceDirectory()
  if (!directory) {
    void vscode.window.showWarningMessage("MindScript Studio: open a folder first.")
    return
  }
  const panel = vscode.window.createWebviewPanel("mindscript.tab", "MindScript Studio", vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })
  editorPanel = panel
  panel.onDidDispose(() => { if (editorPanel === panel) editorPanel = undefined })
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png")
  panel.webview.html = html(panel.webview, undefined)
  try {
    const info = await manager!.ensure(directory)
    panel.webview.html = html(panel.webview, appUrl(info, directory))
  } catch (e) {
    panel.webview.html = html(panel.webview, undefined, String(e instanceof Error ? e.message : e))
  }
}

async function openExistingConversation(context: vscode.ExtensionContext, value?: string): Promise<void> {
  const input = value ?? await vscode.window.showInputBox({
    title: "Open an existing MindScript conversation",
    prompt: "Paste its full browser link. This opens the same running session in the Studio editor column.",
    placeHolder: "http://127.0.0.1:…/…/session/ses_…",
    value: context.workspaceState.get<string>("mindscript.lastSessionLink"),
  })
  if (!input) return
  try {
    const target = parseSessionLink(input)
    const token = target.url.searchParams.get("auth_token")
    const response = await fetch(`${target.serverURL}/session/${target.sessionID}`, {
      headers: { ...(target.directory ? { "x-opencode-directory": target.directory } : {}), ...(token ? { authorization: `Basic ${token}` } : {}) },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`The existing session could not be opened (HTTP ${response.status}). Check that its Studio server is running.`)
    const session = await response.json() as { id?: string; title?: string; directory?: string }
    if (session.id !== target.sessionID || (target.directory && session.directory !== target.directory)) throw new Error("The server returned a different session or project.")
    const group = vscode.window.tabGroups.all.find(g => g.tabs.some(t => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes("mindscript.tab")))
    const panel = editorPanel ?? vscode.window.createWebviewPanel("mindscript.tab", "MindScript Studio", group?.viewColumn ?? vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [context.extensionUri],
    })
    editorPanel = panel
    panel.onDidDispose(() => { if (editorPanel === panel) editorPanel = undefined })
    panel.title = session.title ? `MindScript · ${session.title}` : "MindScript Studio"
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png")
    target.url.searchParams.set("vscode_theme", vscodeThemeParam())
    target.url.searchParams.set("zoom", String(panelZoom()))
    panel.webview.html = html(panel.webview, target.url.toString())
    panel.reveal(group?.viewColumn ?? panel.viewColumn, false)
    // Credentials, if present in an existing local link, are not saved in workspace settings.
    if (!token) await context.workspaceState.update("mindscript.lastSessionLink", input)
    void vscode.window.setStatusBarMessage("MindScript: viewing the existing conversation; no prompt submitted.", 5000)
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Could not open the conversation.")
  }
}

function fileReference(): string | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const directory = workspaceDirectory()
  const rel = directory ? path.relative(directory, editor.document.uri.fsPath) : editor.document.uri.fsPath
  const sel = editor.selection
  if (sel.isEmpty) return `@${rel}`
  const a = sel.start.line + 1
  const b = sel.end.line + 1
  return a === b ? `@${rel}#L${a}` : `@${rel}#L${a}-${b}`
}

/** The active file (and selected lines, 1-based like the Studio UI) as a prompt attachment. */
function promptAttachment(): PromptAddMessage | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== "file") return
  const directory = workspaceDirectory()
  const rel = directory ? path.relative(directory, editor.document.uri.fsPath) : editor.document.uri.fsPath
  const sel = editor.selection
  if (sel.isEmpty) return { type: "mindscript.prompt.add", path: rel }
  const startLine = sel.start.line + 1
  const endLine = sel.end.line + 1
  const text = editor.document.getText(new vscode.Range(sel.start.line, 0, sel.end.line, Number.MAX_SAFE_INTEGER))
  return {
    type: "mindscript.prompt.add",
    path: rel,
    selection: { startLine, startChar: 0, endLine, endChar: 0 },
    preview: text.split("\n").slice(0, 2).join("\n"),
  }
}

export function activate(context: vscode.ExtensionContext): void {
  out = vscode.window.createOutputChannel("MindScript")
  manager = new ServerManager(out)
  const provider = new StudioViewProvider(context)
  context.subscriptions.push(
    out,
    vscode.window.registerWebviewViewProvider("mindscript.chat", provider, { webviewOptions: { retainContextWhenHidden: true } }),
    provider.watchForServerChange(),
    // Experiment: MindScript as a native VS Code chat participant (`@mindscript` in the built-in
    // Chat view), alongside the existing sidebar panel — additive, does not replace it.
    registerChatParticipant(context, manager, workspaceDirectory),
  )

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  status.name = "MindScript Studio"
  status.command = "mindscript.showStatus"
  const paint = (info: ServerInfo | undefined) => {
    status.text = info ? `$(sparkle) MindScript :${info.port}` : "$(sparkle) MindScript (off)"
    status.tooltip = info ? `MindScript Studio server ${info.url} (pid ${info.pid})` : "MindScript Studio server is not running"
    status.show()
  }
  paint(undefined)
  context.subscriptions.push(status, manager.onChange(paint))

  context.subscriptions.push(
    vscode.commands.registerCommand("mindscript.open", () => vscode.commands.executeCommand("mindscript.chat.focus")),
    vscode.commands.registerCommand("mindscript.openInTab", () => openInTab(context)),
    vscode.commands.registerCommand("mindscript.openExistingConversation", (url?: string) => openExistingConversation(context, url)),
    vscode.window.registerUriHandler({ handleUri: uri => {
      if (uri.path === "/open-session") return openExistingConversation(context, new URLSearchParams(uri.query).get("url") ?? undefined)
    } }),
    vscode.commands.registerCommand("mindscript.newSession", () => provider.render("/session")),
    vscode.commands.registerCommand("mindscript.addToPrompt", async () => {
      const attachment = promptAttachment()
      const ref = fileReference()
      if (!attachment || !ref) {
        void vscode.window.showInformationMessage("MindScript: no active file to add.")
        return
      }
      await vscode.commands.executeCommand("mindscript.chat.focus")
      const delivered = (await provider.waitForView(3000)) && (await provider.post(attachment))
      if (delivered) {
        void vscode.window.setStatusBarMessage(`MindScript: added ${ref} to the prompt`, 3000)
        return
      }
      // The panel is not available (e.g. still starting): leave the reference on the clipboard.
      await vscode.env.clipboard.writeText(ref)
      void vscode.window.setStatusBarMessage(`MindScript: copied ${ref} — paste it into the prompt`, 4000)
    }),
    vscode.commands.registerCommand("mindscript.copyReference", async () => {
      const ref = fileReference()
      if (!ref) {
        void vscode.window.showInformationMessage("MindScript: no active editor to reference.")
        return
      }
      await vscode.env.clipboard.writeText(ref)
      void vscode.window.setStatusBarMessage(`MindScript: copied ${ref}`, 3000)
    }),
    vscode.commands.registerCommand("mindscript.restartServer", async () => {
      await manager!.stop()
      await provider.render()
    }),
    vscode.commands.registerCommand("mindscript.showStatus", () => {
      const info = manager!.current
      out!.appendLine(info ? `[status] ${info.url} pid ${info.pid} directory ${info.directory}` : "[status] server not running")
      out!.show(true)
    }),
  )

  // Warm the server for the first workspace so the panel opens instantly.
  const directory = workspaceDirectory()
  if (directory) void manager.ensure(directory).catch((e) => out!.appendLine(`[server] ${e instanceof Error ? e.message : e}`))
}

export async function deactivate(): Promise<void> {
  // mindscript_change: detach, don't kill — the server may be shared with another window, a
  // browser tab, or the desktop app (docs/conversation-continuity.md). Closing this window must
  // not end work someone else is watching. "MindScript: Restart Server" still does a real stop.
  await manager?.detach()
}
