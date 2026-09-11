# test262

Upstream [test262](https://github.com/tc39/test262) files, vendored byte-for-byte and run verbatim by
`test/test262.test.ts`. Licensed under `test/LICENSE.test262`.

## Layout

- `manifest.json` — the pinned upstream revision, which upstream directories are vendored, and what is left out.
- `built-ins/`, `language/` — the vendored files, mirroring upstream `test/`.
- `skipped.txt` — vendored files that fail on a known interpreter gap, one `path  # reason` per line. They are
  skipped, and each gap is listed as unchecked in `interpreter-support.md`.
- `run.ts` — runs one file: prepends `"use strict"`, provides the harness (`assert`, `Test262Error`,
  `compareArray`, `$DONE`, `$DONOTEVALUATE`) as host globals, and interprets the file's frontmatter (`negative`,
  `flags: [async]`).

## What is not vendored

`script/sync-test262.ts` skips a file when its frontmatter declares a `flags`, `features`, or `includes` value the
manifest marks unsupported, or when its code matches one of the manifest's `boundaries` patterns. Boundaries are
intentional limits of the interpreter, not compatibility work: classes, `this`, `arguments`, prototype objects,
property descriptors, accessors, boxed primitives, sloppy mode, `eval`, `Symbol()`, and the `$262` host API. If one
of those decisions changes, delete its entry and re-sync; the tests are upstream, not lost.

## Commands

```sh
bun run script/sync-test262.ts /path/to/test262   # re-copy at the pinned revision; edit manifest.json to change scope
bun run script/test262-report.ts [--write] [dir]  # run everything, group failures by cause; --write regenerates skipped.txt
bun test test/test262.test.ts                     # what CI runs
```

When a fix makes skipped files pass, the report lists them so they can be removed from `skipped.txt`, and the
matching gap in `interpreter-support.md` is checked in the same change.
