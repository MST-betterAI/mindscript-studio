# Desktop staging build — installation plan

**Do not install this without coordinating with Bob.** It replaces the desktop app the Founder
is currently using, and a live 30-turn workflow is running on Studio 4397.

| Field | Value |
|---|---|
| Source revision | `d293917025` |
| App version | 1.18.30 |
| Built (UTC) | 2026-09-14T16:57:07Z |
| Artifact | `packages/desktop/dist-staging/mindscript-studio-mac-arm64.dmg` |
| dmg SHA-256 | `26f6c81ed5e247439553f534b5dc498e5a8dd39df87022cdef53f8609a0fc78e` |
| Signing | **unsigned** — no valid identity present at build time |
| Output dir | `dist-staging/` — deliberately NOT `dist/`, so the existing release output is untouched |

## What this build contains that the installed app does not

The app in `/Applications` predates all of today's work. This build adds:

- Image input declared, so an attached image reaches the engine instead of being replaced with
  "this model does not support image input".
- Web search offered to the model under our own provider.
- Open an existing conversation by link (`mindscript://open-session?url=…`), plus the
  **Copy link to this conversation** and **Open conversation from copied link** commands.
- The home history fix: conversations are no longer hidden from anyone who never added a
  project.
- Four distinct empty-list states — loading, failed, filtered-empty, genuinely empty — instead
  of one "Nothing here yet".

## Install

1. Confirm with Bob that no live workflow turn is mid-flight.
2. Quit the running **MindScript Studio** (it holds a single-instance lock; a second launch just
   forwards to the running copy and exits, which is why it cannot simply be replaced underneath).
3. `open packages/desktop/dist-staging/mindscript-studio-mac-arm64.dmg` and drag the app over
   the one in `/Applications`.
4. Because the build is unsigned, first launch needs **right-click → Open** once, or
   `xattr -dr com.apple.quarantine "/Applications/MindScript Studio.app"`.
5. Reopen and confirm the version, then verify a conversation opens from a link.

## Rollback

The previous app is not modified by building this. If the new one misbehaves, reinstall from
`packages/desktop/dist/mindscript-studio-mac-arm64.dmg`, which is the earlier output and is
untouched by this staging build.

## Not yet verified

**Desktop acceptance has not been observed.** No claim is made that the desktop UI loads the
same session as the browser — that check needs this build installed and running, which is the
step this document exists to schedule.
