#!/usr/bin/env bun
// MindScript Studio branding — applied on top of upstream OpenCode.
//
// Idempotent and explicit: every edit is a targeted replacement in a named file.
// If neither the upstream text nor the branded text is found, the script fails
// loudly — that is how we notice upstream drift after a rebase.
//
//   bun script/branding/apply.ts            # apply
//   bun script/branding/apply.ts --check    # report what is still unbranded, change nothing
//
// Every edited line carries a `mindscript_change` marker (in comments) where the
// language allows it, so `git grep mindscript_change` lists our footprint.
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const CHECK = process.argv.includes("--check")
let changed = 0
let pending = 0
const problems: string[] = []

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
const write = (rel: string, text: string) => {
  if (CHECK) return
  fs.writeFileSync(path.join(ROOT, rel), text)
}

/** Replace `from` with `to` exactly `count` times (default: every occurrence, at least one). */
function replace(rel: string, from: string, to: string, opts: { all?: boolean; optional?: boolean } = {}): void {
  const src = read(rel)
  // Every `to` carries "mindscript", so its presence means this edit was applied
  // (also for insertions, where `to` still contains the upstream `from` text).
  if (src.includes(to)) return // already branded
  if (!src.includes(from)) {
    if (opts.optional) return
    problems.push(`${rel}: expected upstream text not found:\n    ${from.split("\n")[0]}`)
    return
  }
  const out = opts.all === false ? src.replace(from, to) : src.split(from).join(to)
  if (CHECK) {
    pending++
    console.log(`would edit ${rel}`)
    return
  }
  write(rel, out)
  changed++
}

function regexReplace(rel: string, re: RegExp, to: string | ((...m: string[]) => string), doneMarker: string): void {
  const src = read(rel)
  if (src.includes(doneMarker)) return
  if (!re.test(src)) {
    problems.push(`${rel}: pattern ${re} not found`)
    return
  }
  const out = src.replace(re, to as string)
  if (CHECK) {
    pending++
    console.log(`would edit ${rel}`)
    return
  }
  write(rel, out)
  changed++
}

function ensureFile(rel: string, content: string): void {
  const p = path.join(ROOT, rel)
  if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === content) return
  if (CHECK) {
    pending++
    console.log(`would write ${rel}`)
    return
  }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  changed++
}

// ---------------------------------------------------------------------------
// 1. Identity: app dirs, env aliases, project dirs, config file names
// ---------------------------------------------------------------------------

// ~/.config/mindscript, ~/.local/share/mindscript, ~/.cache/mindscript, …
replace("packages/core/src/global.ts", 'const app = "opencode"', 'const app = "mindscript" // mindscript_change')

// MINDSCRIPT_* env vars win over OPENCODE_*; both keep working.
{
  const rel = "packages/core/src/flag/flag.ts"
  const src = read(rel)
  if (!src.includes("mindscript_change")) {
    let out = src.replace(
      'import { Config } from "effect"\n',
      'import { Config } from "effect"\n\n// mindscript_change: MINDSCRIPT_<X> takes precedence over OPENCODE_<X>; both work.\nfunction env(key: string): string | undefined {\n  const alias = key.startsWith("OPENCODE_") ? "MINDSCRIPT_" + key.slice("OPENCODE_".length) : undefined\n  return (alias ? process.env[alias] : undefined) ?? process.env[key]\n}\n',
    )
    out = out.replace("const value = process.env[key]?.toLowerCase()", "const value = env(key)?.toLowerCase()")
    out = out.replace(/process\.env\["(OPENCODE_[A-Z0-9_]+)"\]/g, 'env("$1")')
    if (out === src) problems.push(`${rel}: nothing to alias`)
    else if (CHECK) { pending++; console.log(`would edit ${rel}`) } else { write(rel, out); changed++ }
  }
}

// Project config dir: .mindscript/ first, .opencode/ still honoured.
replace("packages/opencode/src/config/paths.ts", 'targets: [".opencode"],', 'targets: [".mindscript", ".opencode"], // mindscript_change')

// Global config files: mindscript.json[c] merge after opencode.json[c].
replace(
  "packages/opencode/src/config/config.ts",
  '      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"), env))\n',
  '      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"), env))\n      // mindscript_change: our own file names, merged last so they win.\n      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "mindscript.json"), env))\n      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "mindscript.jsonc"), env))\n',
)
// Project-level mindscript.json[c] next to opencode.json[c].
replace(
  "packages/opencode/src/config/config.ts",
  '          for (const file of yield* ConfigPaths.files("opencode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {\n            yield* merge(file, yield* loadFile(file, authEnv), "local")\n          }\n',
  '          for (const file of yield* ConfigPaths.files("opencode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {\n            yield* merge(file, yield* loadFile(file, authEnv), "local")\n          }\n          // mindscript_change\n          for (const file of yield* ConfigPaths.files("mindscript", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {\n            yield* merge(file, yield* loadFile(file, authEnv), "local")\n          }\n',
)
replace(
  "packages/opencode/src/config/config.ts",
  '          if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {\n            for (const file of ["opencode.json", "opencode.jsonc"]) {',
  '          if (dir.endsWith(".opencode") || dir.endsWith(".mindscript") || dir === Flag.OPENCODE_CONFIG_DIR) { // mindscript_change\n            for (const file of ["opencode.json", "opencode.jsonc", "mindscript.json", "mindscript.jsonc"]) {',
)

// ---------------------------------------------------------------------------
// 2. Baked defaults: the MindScript engine is pre-configured; user config merges on top.
// ---------------------------------------------------------------------------
replace(
  "packages/opencode/src/config/config.ts",
  'import { ConfigManaged } from "./managed"\n',
  `import { ConfigManaged } from "./managed"

// mindscript_change: MindScript Studio ships with its engine pre-configured. Every
// user/project config merges on top, so anything here can be overridden. The key
// is not here: it comes from \`mindscript auth login\` (auth.json) or the user's config.
function mindscriptBuiltinConfig(): Info {
  const baseURL = (process.env["MINDSCRIPT_BASE_URL"] ?? "http://127.0.0.1:8787/v1").replace(/\\/$/, "")
  const zero = { input: 0, output: 0, cache_read: 0, cache_write: 0 }
  return {
    provider: {
      mindscript: {
        npm: "@ai-sdk/openai-compatible",
        name: "MindScript",
        options: { baseURL, headers: { "X-MindScript-Client": "mindscript-studio" } },
        models: {
          auto: { name: "MindScript Auto", tool_call: true, attachment: true, limit: { context: 400000, output: 32000 }, cost: zero },
          premium: { id: "claude-fable-5-1", name: "MindScript Premium", tool_call: true, attachment: true, limit: { context: 1000000, output: 32000 }, cost: zero },
        },
      },
    },
    model: "mindscript/auto",
    small_model: "mindscript/auto",
    enabled_providers: ["mindscript"],
    share: "disabled",
    autoupdate: false,
  } as unknown as Info
}
`,
)
replace(
  "packages/opencode/src/config/config.ts",
  "        const global = Object.keys(authEnv).length ? yield* loadGlobal(authEnv) : yield* getGlobal()\n",
  '        yield* merge("mindscript-builtin", mindscriptBuiltinConfig(), "global") // mindscript_change\n        const global = Object.keys(authEnv).length ? yield* loadGlobal(authEnv) : yield* getGlobal()\n',
)

// ---------------------------------------------------------------------------
// 3. The binary is `mindscript`
// ---------------------------------------------------------------------------
replace("packages/opencode/package.json", '"bin": {\n    "opencode": "./bin/opencode"\n  }', '"bin": {\n    "mindscript": "./bin/mindscript",\n    "opencode": "./bin/opencode"\n  }', { optional: true })
regexReplace("packages/opencode/package.json", /"bin":\s*\{\s*"opencode":\s*"\.\/bin\/opencode"\s*\}/, '"bin": { "mindscript": "./bin/mindscript", "opencode": "./bin/opencode" }', '"mindscript": "./bin/mindscript"')
{
  const src = path.join(ROOT, "packages/opencode/bin/opencode")
  const dst = path.join(ROOT, "packages/opencode/bin/mindscript")
  if (!fs.existsSync(dst)) {
    if (CHECK) { pending++; console.log("would create packages/opencode/bin/mindscript") } else {
      fs.copyFileSync(src, dst)
      fs.chmodSync(dst, 0o755)
      changed++
    }
  }
}
replace("packages/opencode/script/build.ts", "outfile: `dist/${name}/bin/opencode`,", "outfile: `dist/${name}/bin/mindscript`, // mindscript_change")
replace("packages/opencode/script/build.ts", "execArgv: [`--user-agent=opencode/${Script.version}`,", "execArgv: [`--user-agent=mindscript/${Script.version}`,")
replace("packages/opencode/script/build.ts", "const binaryPath = `dist/${name}/bin/opencode`", "const binaryPath = `dist/${name}/bin/mindscript` // mindscript_change")

// ---------------------------------------------------------------------------
// 4. Desktop app identity
// ---------------------------------------------------------------------------
const EB = "packages/desktop/electron-builder.config.ts"
replace(EB, 'artifactName: "opencode-desktop-${os}-${arch}.${ext}",', 'artifactName: "mindscript-studio-${os}-${arch}.${ext}", // mindscript_change')
replace(EB, '  dev: "ai.opencode.desktop.dev",\n  beta: "ai.opencode.desktop.beta",\n  prod: "ai.opencode.desktop",', '  dev: "ai.mindscript.studio.dev",\n  beta: "ai.mindscript.studio.beta",\n  prod: "ai.mindscript.studio",')
replace(EB, '  protocols: {\n    name: "OpenCode",\n    schemes: ["opencode"],\n  },', '  protocols: {\n    name: "MindScript Studio",\n    schemes: ["mindscript"],\n  },')
// Signing/notarization only when credentials are deliberately provided.
replace(EB, "    hardenedRuntime: true,\n", '    hardenedRuntime: process.env.MINDSCRIPT_SIGN === "1", // mindscript_change\n')
replace(EB, "    notarize: true,\n", '    notarize: process.env.MINDSCRIPT_SIGN === "1",\n')
replace(EB, "  dmg: {\n    sign: true,\n  },", '  dmg: {\n    sign: process.env.MINDSCRIPT_SIGN === "1",\n  },')
// Without a Developer ID, electron-builder leaves the bundle with Electron's
// linker-only signature and no resource seal; Finder/LaunchServices then refuses
// to launch it (codesign: "code has no resources but signature indicates they must
// be present"). An ad-hoc deep signature after packing makes the dmg/zip launchable
// (Gatekeeper still shows the unidentified-developer prompt until MINDSCRIPT_SIGN=1).
replace(
  EB,
  "const channel = (() => {\n  const raw = process.env.OPENCODE_CHANNEL",
  `// mindscript_change: ad-hoc sign the packed app when no Developer ID is used.
async function adhocSign(context: { appOutDir: string; electronPlatformName: string; packager: { appInfo: { productFilename: string } } }) {
  if (context.electronPlatformName !== "darwin") return
  if (process.env.MINDSCRIPT_SIGN === "1") return
  const appPath = path.join(context.appOutDir, \`\${context.packager.appInfo.productFilename}.app\`)
  await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", appPath])
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appPath])
  console.log(\`  • ad-hoc signed  \${appPath}\`)
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL`,
)
replace(EB, '  mac: {\n    category: "public.app-category.developer-tools",', '  afterPack: adhocSign, // mindscript_change\n  mac: {\n    category: "public.app-category.developer-tools",')
replace(EB, 'productName: "OpenCode Dev",', 'productName: "MindScript Studio Dev",')
replace(EB, 'rpm: { packageName: "opencode-dev", fpm: [metainfoFpm(appId)] },', 'rpm: { packageName: "mindscript-studio-dev", fpm: [metainfoFpm(appId)] },')
replace(EB, 'productName: "OpenCode Beta",', 'productName: "MindScript Studio Beta",')
replace(EB, 'protocols: { name: "OpenCode Beta", schemes: ["opencode"] },', 'protocols: { name: "MindScript Studio Beta", schemes: ["mindscript"] },')
replace(EB, 'publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },', 'publish: { provider: "github", owner: "MST-betterAI", repo: "mindscript-studio-beta", channel: "latest" },')
replace(EB, 'rpm: { packageName: "opencode-beta", fpm: [metainfoFpm(appId)] },', 'rpm: { packageName: "mindscript-studio-beta", fpm: [metainfoFpm(appId)] },')
replace(EB, 'productName: "OpenCode",', 'productName: "MindScript Studio",')
replace(EB, 'protocols: { name: "OpenCode", schemes: ["opencode"] },', 'protocols: { name: "MindScript Studio", schemes: ["mindscript"] },')
replace(EB, 'publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },', 'publish: { provider: "github", owner: "MST-betterAI", repo: "mindscript-studio", channel: "latest" },')
replace(EB, 'rpm: { packageName: "opencode", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },', 'rpm: { packageName: "mindscript-studio", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },')

// 4b. Desktop main process: the same identity at runtime. The app id names the
// data folder (~/Library/Application Support/<id>) and Electron's single-instance
// lock is keyed on it — with the upstream id, MindScript Studio silently quits
// whenever the stock OpenCode desktop app is open.
const DM = "packages/desktop/src/main"
const APP_ID_BLOCK = '  dev: "ai.opencode.desktop.dev",\n  beta: "ai.opencode.desktop.beta",\n  prod: "ai.opencode.desktop",'
const APP_ID_BLOCK_MS = '  dev: "ai.mindscript.studio.dev", // mindscript_change\n  beta: "ai.mindscript.studio.beta",\n  prod: "ai.mindscript.studio",'
replace(`${DM}/index.ts`, '  dev: "OpenCode Dev",\n  beta: "OpenCode Beta",\n  prod: "OpenCode",', '  dev: "MindScript Studio Dev", // mindscript_change\n  beta: "MindScript Studio Beta",\n  prod: "MindScript Studio",')
replace(`${DM}/index.ts`, APP_ID_BLOCK, APP_ID_BLOCK_MS)
replace(`${DM}/index.ts`, 'const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"', 'const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.mindscript.studio.dev" // mindscript_change')
replace(`${DM}/index.ts`, 'app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenCode Dev")', 'app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "MindScript Studio Dev") // mindscript_change')
replace(`${DM}/index.ts`, 'const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))', 'const urls = argv.filter((arg: string) => arg.startsWith("mindscript://")) // mindscript_change')
replace(`${DM}/index.ts`, 'app.setAsDefaultProtocolClient("opencode")', 'app.setAsDefaultProtocolClient("mindscript") // mindscript_change')
// The Tauri-era migration must never read the stock OpenCode app's folder.
replace(`${DM}/migrate.ts`, APP_ID_BLOCK, APP_ID_BLOCK_MS)
replace(`${DM}/migrate.ts`, 'return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"', 'return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : "ai.mindscript.studio.dev" // mindscript_change')
replace(`${DM}/background-cli.ts`, 'const desktopStateNames = ["ai.opencode.desktop.dev", "ai.opencode.desktop.beta", "ai.opencode.desktop"]', 'const desktopStateNames = ["ai.mindscript.studio.dev", "ai.mindscript.studio.beta", "ai.mindscript.studio"] // mindscript_change')
replace(`${DM}/windows.ts`, '    title: "OpenCode",\n', '    title: "MindScript Studio", // mindscript_change\n')
// Deep links: accept mindscript:// (and keep opencode:// so upstream tests still pass).
replace("packages/app/src/pages/layout/deep-links.ts", '  if (!input.startsWith("opencode://")) return\n', '  if (!input.startsWith("mindscript://") && !input.startsWith("opencode://")) return // mindscript_change\n')

// ---------------------------------------------------------------------------
// 4c. Links and fetches that would send people (or requests) to upstream
// ---------------------------------------------------------------------------
const REPO = "https://github.com/MST-betterAI/mindscript-studio"
replace("packages/app/src/desktop-menu.ts", '{ type: "item", labelKey: "desktop.menu.documentation", href: "https://opencode.ai/docs" },', `{ type: "item", labelKey: "desktop.menu.documentation", href: "${REPO}#readme" }, // mindscript_change`)
replace("packages/app/src/desktop-menu.ts", '{ type: "item", labelKey: "desktop.menu.supportForum", href: "https://discord.com/invite/opencode" },', `{ type: "item", labelKey: "desktop.menu.supportForum", href: "${REPO}/issues" }, // mindscript_change`)
for (const f of ["packages/app/src/pages/layout.tsx", "packages/app/src/pages/error.tsx", "packages/app/src/pages/home/home-projects-controller.tsx"]) {
  replace(f, 'platform.openExternal("https://opencode.ai/desktop-feedback")', `platform.openExternal("${REPO}/issues") /* mindscript_change */`)
}
// Desktop notifications showed the upstream favicon fetched from opencode.ai.
replace("packages/app/src/entry.tsx", '    icon: "https://opencode.ai/favicon-96x96-v3.png",', '    icon: "/favicon-96x96-v3.png", // mindscript_change')
replace("packages/desktop/src/renderer/index.tsx", '        icon: "https://opencode.ai/favicon-96x96-v3.png",', '        icon: "/favicon-96x96-v3.png", // mindscript_change')
// Release highlights come from our own changelog (served from the public site once it exists;
// a missing file just means no highlights dialog).
replace("packages/app/src/context/highlights.tsx", 'const CHANGELOG_URL = "https://opencode.ai/changelog.json"', 'const CHANGELOG_URL = "https://mindscript.ai/studio/changelog.json" // mindscript_change')
replace("packages/app/src/i18n/en.ts", '"error.page.report.discord": "on Discord",', '"error.page.report.discord": "on GitHub", // mindscript_change', { optional: true })

// ---------------------------------------------------------------------------
// 5. Web app + desktop renderer: title and user-facing strings
// ---------------------------------------------------------------------------
replace("packages/app/index.html", "<title>OpenCode</title>", "<title>MindScript Studio</title>")
for (const dir of ["packages/app/src/i18n", "packages/desktop/src/renderer/i18n"]) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) continue
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue
    const rel = `${dir}/${f}`
    const src = read(rel)
    if (!/\bOpenCode\b/.test(src)) continue
    const out = src.replace(/\bOpenCode Zen\b/g, "Zen").replace(/\bOpenCode\b/g, "MindScript Studio")
    if (CHECK) { pending++; console.log(`would edit ${rel}`) } else { write(rel, out); changed++ }
  }
}

// ---------------------------------------------------------------------------
// 6. Terminal logos
// ---------------------------------------------------------------------------
ensureFile(
  "packages/tui/src/logo.ts",
  `// mindscript_change: MindScript Studio wordmark ("MIND" + "SCRIPT") in the TUI's block font.
export const logo = {
  left: ["                   ", "█▀▄▀█ ▀█▀ █▀▀▄ █▀▀▄", "█_▀_█ _█_ █__█ █__█", "▀___▀ ▀▀▀ ▀__▀ ▀▀▀_"],
  right: ["                             ", "█▀▀▀ █▀▀▀ █▀▀█ ▀█▀ █▀▀█ ▀▀█▀▀", "▀▀▀█ █___ █▀▀▄ _█_ █▀▀▀ __█__", "▀▀▀▀ ▀▀▀▀ ▀__▀ ▀▀▀ ▀___ __▀__"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
`,
)
replace(
  "packages/opencode/src/cli/ui.ts",
  "  `█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█`,\n  `█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀`,\n  `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`,",
  "  `█▀▄▀█ ▀█▀ █▀▀▄ █▀▀▄ █▀▀▀ █▀▀▀ █▀▀█ ▀█▀ █▀▀█ ▀▀█▀▀`, // mindscript_change\n  `█ ▀ █  █  █  █ █  █ ▀▀▀█ █    █▀▀▄  █  █▀▀▀   █  `,\n  `▀   ▀ ▀▀▀ ▀  ▀ ▀▀▀  ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀ ▀      ▀  `,",
)

// ---------------------------------------------------------------------------
// 7. README + NOTICE (upstream README is replaced wholesale; keep ours)
// ---------------------------------------------------------------------------
ensureFile(
  "README.md",
  `# MindScript Studio

**Smarter Faster Cheaper.** A coding agent that runs in your terminal, in your browser and as a desktop
app, whose model provider is the [MindScript](https://mindscript.ai) engine: every request is routed to
the best-value model, with project memory and honest cost accounting.

MindScript Studio is a fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT, © Anomaly and
contributors), pinned to the version in \`.opencode-version\` and rebased regularly. It is not built by,
affiliated with or endorsed by the OpenCode team. Our changes carry a \`mindscript_change\` marker;
\`bun script/branding/apply.ts --check\` reports any that upstream drift has undone.

## Build

\`\`\`bash
bun install
bun script/branding/apply.ts                 # re-apply branding after a rebase (idempotent)
cd packages/opencode && bun run script/build.ts --single   # CLI for this machine → dist/*/bin/mindscript
cd ../desktop && OPENCODE_CHANNEL=dev bun run build && bun run package:mac   # desktop (unsigned dev build)
\`\`\`

Signing and notarization run only with \`MINDSCRIPT_SIGN=1\` and Apple credentials in the environment.

## Configuration

Everything OpenCode supports, plus: \`~/.config/mindscript/mindscript.json\` (and \`opencode.json\`),
a project's \`.mindscript/\` (and \`.opencode/\`), and \`MINDSCRIPT_*\` environment variables (aliases of
\`OPENCODE_*\`). The \`mindscript\` provider is built in; \`MINDSCRIPT_BASE_URL\` points it at a gateway
(default \`http://127.0.0.1:8787/v1\`).

## License

MIT — see \`LICENSE\` (upstream) and \`NOTICE\`.
`,
)
ensureFile(
  "NOTICE",
  `MindScript Studio
Copyright (c) 2026 Mindscript Technologies LLC

This product is a fork of OpenCode (https://github.com/anomalyco/opencode),
Copyright (c) 2025 opencode, licensed under the MIT License (see LICENSE).
OpenCode is not affiliated with, and does not endorse, MindScript Studio.
`,
)

// ---------------------------------------------------------------------------
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`)
  process.exit(1)
}
console.log(CHECK ? `check: ${pending} file(s) still to brand` : `branding applied: ${changed} file(s) changed`)