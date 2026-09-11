# MindScript Studio

**Smarter Faster Cheaper.** A coding agent that runs in your terminal, in your browser and as a desktop
app, whose model provider is the [MindScript](https://mindscript.ai) engine: every request is routed to
the best-value model, with project memory and honest cost accounting.

MindScript Studio is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT, © Anomaly and
contributors), pinned to the version in `.opencode-version` and rebased regularly. It is not built by,
affiliated with or endorsed by the OpenCode team. Our changes carry a `mindscript_change` marker;
`bun script/branding/apply.ts --check` reports any that upstream drift has undone.

## Build

```bash
bun install
bun script/branding/apply.ts                 # re-apply branding after a rebase (idempotent)
cd packages/opencode && bun run script/build.ts --single   # CLI for this machine → dist/*/bin/mindscript
cd ../desktop && OPENCODE_CHANNEL=dev bun run build && bun run package:mac   # desktop (unsigned dev build)
```

Signing and notarization run only with `MINDSCRIPT_SIGN=1` and Apple credentials in the environment.

## Configuration

Everything OpenCode supports, plus: `~/.config/mindscript/mindscript.json` (and `opencode.json`),
a project's `.mindscript/` (and `.opencode/`), and `MINDSCRIPT_*` environment variables (aliases of
`OPENCODE_*`). The `mindscript` provider is built in; `MINDSCRIPT_BASE_URL` points it at a gateway
(default `http://127.0.0.1:8787/v1`).

## License

MIT — see `LICENSE` (upstream) and `NOTICE`.
