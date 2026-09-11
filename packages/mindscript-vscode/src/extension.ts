// MindScript Studio for VS Code: the Studio web UI, served by a local `mindscript serve`
// for this workspace, embedded in a sidebar view (and optionally an editor tab).
import * as vscode from "vscode"
import * as path from "node:path"
import { ServerManager, type ServerInfo } from "./server"

let manager: ServerManager | undefined
let out: vscode.OutputChannel | undefined

function workspaceDirectory(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri
  const folders = vscode.workspace.workspaceFolders ?? []
  if (active) {
    const owner = vscode.workspace.getWorkspaceFolder(active)
    if (owner) return owner.uri.fsPath
  }
  return folders[0]?.uri.fsPath
}

/** The web UI addresses a project by the base64url of its absolute path. */
function appUrl(info: ServerInfo, directory: string, route = "/session"): string {
  const dir = Buffer.from(directory).toString("base64url")
  const token = Buffer.from(`${info.username}:${info.password}`).toString("base64")
  return `${info.url}/${dir}${route}?auth_token=${encodeURIComponent(token)}`
}

function html(webview: vscode.Webview, src: string | undefined, error?: string): string {
  const origin = src ? new URL(src).origin : ""
  const csp = `default-src 'none'; frame-src ${origin} http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'; img-src ${webview.cspSource} data:;`
  const body = src
    ? `<iframe id="studio" src="${src}" allow="clipboard-read; clipboard-write"></iframe>`
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
      view.webview.html = html(view.webview, appUrl(info, directory, route))
    } catch (e) {
      view.webview.html = html(view.webview, undefined, String(e instanceof Error ? e.message : e))
    }
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
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.png")
  panel.webview.html = html(panel.webview, undefined)
  try {
    const info = await manager!.ensure(directory)
    panel.webview.html = html(panel.webview, appUrl(info, directory))
  } catch (e) {
    panel.webview.html = html(panel.webview, undefined, String(e instanceof Error ? e.message : e))
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

export function activate(context: vscode.ExtensionContext): void {
  out = vscode.window.createOutputChannel("MindScript")
  manager = new ServerManager(out)
  const provider = new StudioViewProvider(context)
  context.subscriptions.push(
    out,
    vscode.window.registerWebviewViewProvider("mindscript.chat", provider, { webviewOptions: { retainContextWhenHidden: true } }),
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
    vscode.commands.registerCommand("mindscript.newSession", () => provider.render("/session")),
    vscode.commands.registerCommand("mindscript.addToPrompt", async () => {
      const ref = fileReference()
      if (!ref) {
        void vscode.window.showInformationMessage("MindScript: no active editor to reference.")
        return
      }
      await vscode.env.clipboard.writeText(ref)
      void vscode.window.setStatusBarMessage(`MindScript: copied ${ref} — paste it into the prompt`, 4000)
      await vscode.commands.executeCommand("mindscript.chat.focus")
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
  await manager?.stop()
}
