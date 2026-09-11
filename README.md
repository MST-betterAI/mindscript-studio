# MindScript Studio

**Smarter Faster Cheaper.** A coding agent that runs in your terminal, in your browser and as a desktop
app, whose model provider is the [MindScript](https://mindscript.ai) engine: every request is routed to
the best-value model, with project memory and honest cost accounting.

MindScript Studio is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT, © Anomaly and
contributors), pinned to the version in `.opencode-version` and rebased regularly. It is not built by,
affiliated with or endorsed by the OpenCode team. Our changes carry a `mindscript_change` marker;
`bun script/branding/apply.ts --check` reports any that upstream drift has undone.

## What is different from OpenCode

- **MindScript is the only provider.** `mindscript/auto` routes each step; `mindscript/premium` pins the
  premium model (for A/B baselines). The key comes from the normal connect flow or
  `~/.config/mindscript/api-key`.
- **MindScript tab** in the session side panel: every step's model, cost and what always-premium would
  have cost; plus account totals (today / 7 days / all time) served by `GET /mindscript/usage[?since=]`
  on the Studio server (`packages/opencode/src/server/routes/instance/httpapi/{groups,handlers}/mindscript.ts`),
  so the engine key never reaches a browser.
- **VS Code extension** (`packages/mindscript-vscode`): the Studio UI in the sidebar or an editor tab,
  one server per workspace, and *Add File / Selection to the Prompt* (⌘⌥K).
- **Workflows**: `/review` and `/research` commands with reviewer / skeptic agents (installed under
  `~/.config/mindscript/{agent,command}`; source in the `mindscript` repo, `workflows/studio-config`).
- **No upstream egress by default**: share, auto-update, telemetry are off; `mindscript upgrade` points to
  GitHub releases; help links go to this repo. `bun script/check-forbidden-strings.ts` fails on any new
  reference to upstream hosts (baseline in `script/forbidden-strings.baseline.json`); CI runs it.

## Build

```bash
bun install
bun script/branding/apply.ts                 # re-apply branding after a rebase (idempotent; --check to audit)
cd packages/opencode && OPENCODE_VERSION=1.18.30 OPENCODE_CHANNEL=stable bun run script/build.ts --single --skip-install
#   → dist/*/bin/mindscript (the version must be a real upstream npm version, or plugin installs hang)
cd ../desktop && OPENCODE_VERSION=1.18.30 OPENCODE_CHANNEL=prod bun run build && \
  OPENCODE_VERSION=1.18.30 OPENCODE_CHANNEL=prod bun run package:mac --publish never
#   → dist/mindscript-studio-mac-arm64.{dmg,zip}; the app is ad-hoc signed after packing so Finder launches it
```

Signing and notarization run only with `MINDSCRIPT_SIGN=1` and Apple credentials in the environment
(without them, other Macs must right-click → Open the first time). Homebrew: `script/homebrew/mindscript.rb`
is the formula for the tap (`script/homebrew/update.sh <tag> <version>` repoints it after a release).

Rebase onto a newer upstream tag with `script/upstream/merge.sh vX.Y.Z`; it merges, re-applies the branding,
typechecks and lists new upstream references.

Testing the desktop app from a shell spawned by VS Code: unset `ELECTRON_RUN_AS_NODE` first (it makes any
Electron binary run as plain Node and exit silently), e.g. `env -i PATH=/usr/bin:/bin HOME=$HOME open <app>`.
Launch logs: `~/Library/Application Support/ai.mindscript.studio/logs/<stamp>/main.log`.

## Configuration

Everything OpenCode supports, plus: `~/.config/mindscript/mindscript.json` (and `opencode.json`),
a project's `.mindscript/` (and `.opencode/`), and `MINDSCRIPT_*` environment variables (aliases of
`OPENCODE_*`). The `mindscript` provider is built in; `MINDSCRIPT_BASE_URL` points it at a gateway
(default `http://127.0.0.1:8787/v1`).

## License

MIT — see `LICENSE` (upstream) and `NOTICE`.
