# MindScript Studio for VS Code

The MindScript Studio coding agent as a sidebar panel (and, if you like, an editor tab). Each
VS Code window runs its own local `mindscript serve` for the open folder; the panel is the
Studio web UI talking to that server. All model calls go through the MindScript engine.

## Requirements

- The `mindscript` binary on your PATH (or set **mindscript.cliPath**). The MindScript engine
  it talks to is configured by the binary (`MINDSCRIPT_BASE_URL`, or **mindscript.baseUrl** here).

## Commands

| Command | What it does |
|---|---|
| MindScript: Open Studio (`⌘Esc`) | Focus the sidebar panel |
| MindScript: Open Studio in an Editor Tab | The same UI, wide |
| MindScript: New Session | Start a fresh session for this folder |
| MindScript: Copy File Reference for the Prompt (`⌘⌥K`) | Copies `@path#L1-L2` for the active file/selection |
| MindScript: Restart Server | Restart the local server |
| MindScript: Show Status | Server URL, pid, and the output log |

## Install without the Marketplace

```bash
cd packages/mindscript-vscode && bun install && bun run vsix
code --install-extension mindscript-studio-0.1.0.vsix
```
