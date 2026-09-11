#!/usr/bin/env bun
// MindScript Studio — forbidden upstream strings in shipped code.
//
// After every rebase onto upstream OpenCode, this guards against new places where
// the product would talk to, or send people to, opencode.ai / opncd.ai. Known
// occurrences are recorded per file in script/forbidden-strings.baseline.json
// (with a note on why each is acceptable for now); anything beyond the baseline
// fails the check.
//
//   bun script/check-forbidden-strings.ts            # check (exit 1 on new occurrences)
//   bun script/check-forbidden-strings.ts --update   # rewrite the baseline counts from the tree
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const UPDATE = process.argv.includes("--update")
const BASELINE_FILE = path.join(ROOT, "script", "forbidden-strings.baseline.json")

// Shipped source only: the CLI/server, the web app, the desktop app, shared UI/core.
const DIRS = ["packages/opencode/src", "packages/app/src", "packages/desktop/src", "packages/ui/src", "packages/core/src"]
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".html", ".css", ".json"])
const SKIP = /(\.test\.|\.stories\.|\/__tests__\/|\/test\/|\/i18n\/)/

// Hosts and paths that must not gain new references. Docs links are included on
// purpose: a customer must never be sent to upstream docs/support from our UI.
const PATTERNS: RegExp[] = [/opncd\.ai/g, /opencode\.ai/g, /discord\.com\/invite\/opencode/g]

type Baseline = Record<string, { count: number; note?: string }>

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue
      walk(abs, out)
      continue
    }
    if (!EXT.has(path.extname(entry.name))) continue
    if (SKIP.test(abs)) continue
    out.push(abs)
  }
}

const files: string[] = []
for (const dir of DIRS) {
  const abs = path.join(ROOT, dir)
  if (fs.existsSync(abs)) walk(abs, files)
}

const found: Record<string, number> = {}
const samples: Record<string, string[]> = {}
for (const abs of files) {
  const rel = path.relative(ROOT, abs)
  const text = fs.readFileSync(abs, "utf8")
  let count = 0
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    for (const re of PATTERNS) {
      re.lastIndex = 0
      const hits = line.match(re)
      if (!hits) continue
      count += hits.length
      ;(samples[rel] ??= []).push(`${i + 1}: ${line.trim().slice(0, 110)}`)
    }
  })
  if (count) found[rel] = count
}

const baseline: Baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) : {}

if (UPDATE) {
  const next: Baseline = {}
  for (const rel of Object.keys(found).sort()) next[rel] = { count: found[rel], note: baseline[rel]?.note }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n")
  console.log(`baseline updated: ${Object.keys(next).length} file(s), ${Object.values(next).reduce((a, b) => a + b.count, 0)} occurrence(s)`)
  process.exit(0)
}

let failed = false
for (const rel of Object.keys(found).sort()) {
  const allowed = baseline[rel]?.count ?? 0
  if (found[rel] <= allowed) continue
  failed = true
  console.log(`NEW upstream reference(s) in ${rel}: ${found[rel]} found, ${allowed} allowed`)
  for (const s of samples[rel] ?? []) console.log(`    ${s}`)
}
for (const rel of Object.keys(baseline)) {
  if (found[rel]) continue
  console.log(`note: ${rel} no longer has upstream references — run with --update to drop it from the baseline`)
}
const total = Object.values(found).reduce((a, b) => a + b, 0)
console.log(failed ? `forbidden strings: FAIL (${total} occurrence(s) in ${Object.keys(found).length} file(s))` : `forbidden strings: OK (${total} known occurrence(s) in ${Object.keys(found).length} file(s), none new)`)
process.exit(failed ? 1 : 0)
