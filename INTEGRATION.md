# Integration manifest

This file documents what `josh/integration` currently includes. It's a
human-maintained snapshot that lives on integration only (not on patch
branches or `master`).

`josh/integration` is **long-lived and maintained, not regenerated** —
see "Branch model" / "Maintaining integration" in `CLAUDE.md`. Each
patch is a durable `--no-ff` merge; conflict resolutions are permanent
commits. When you add, update, or remove a patch, update this file's
table **in the same change**, run `scripts/integration-check`, then
plain-`git push` (no force). The next reader should be able to tell
what's deployed by reading this file, not by spelunking the merge graph.

## Patch branches in the current integration

| Branch | Origin | Upstream status | What it does |
|---|---|---|---|
| `josh/chrome-shader` | local | Not yet PRed upstream | The big chrome+wallpaper overhaul. Live-rendered wallpaper as a multi-monitor canvas with the "hexrain" scene (continuous-direction cast shadows, palette-flip wave, dynamic sun counts, bar-zone elevation/anchor, per-output activation). Includes ShaderSceneEditor for live iteration (toggleable). Adds `Theme.widgetBackgroundColor = "scl"` (surfaceContainerLowest) and a `barConfig.widgetPill` toggle for capsule-shaped chrome. SceneStateService writes to an XDG state shadow so saves persist without polluting the source. |
| `josh/wider-pills` | local | Not yet PRed upstream | Single-line change to `Modules/DankBar/DankBarWindow.qml`: bumps `widgetThickness` base from `26` to `36`. Combined with `innerPadding=0` in the user's `barConfigs`, pills go from ~28px to ~36px wide while the bar stays at 40px — eliminates the "pills floating in a wide channel" look. |
| `josh/icon-cleanup` | local | Not yet PRed upstream | `RamMonitor.qml`: icon `developer_board` → `memory_alt`. `developer_board` (PCB with chips) reads as a graphics card, not a RAM stick; `memory_alt` (DIMM-shaped) is correct. Frees `developer_board` for downstream GPU plugins (dms-gpu-pill) without clashing with the CPU's `memory` icon. |
| `josh/notif-suppress-sound` | local | Not yet PRed upstream (PR-ready off `master`) | `Services/NotificationService.qml`: honor the freedesktop `org.freedesktop.Notifications` `suppress-sound` boolean hint. Senders that play their own audio for a notification can set the hint to ask DMS not to double up. Previously DMS skipped its own sound only as a side effect of the dedup early-return (when an identically-keyed popup was still visible), so transient notifications double-sounded while lingering ones didn't — nondeterministic. Motivated by nix-config's `ntfy-notify` handler, which plays its own classified chime and sets `suppress-sound`. |

## Tooling commits

Tooling lives **persistently on the branch** (not a single rebased-away
base commit — integration is maintained, not regenerated). These files
must never bleed into an upstream PR; patch branches branch off
`master` so they never inherit them, and `scripts/integration-check`
excludes them from the oracle diff:

- `CLAUDE.md` — agent guide: branch model + maintaining integration
- `INTEGRATION.md` — this file
- `scripts/integration-check` — the oracle gate (below)
- `.gitignore` additions — `/worktrees`, `/reference` (out-of-tree dirs
  for git worktrees and prior-art reference checkouts, if used)

## The oracle gate (`scripts/integration-check`)

Run before every push. It diffs what *this* integration adds versus
`origin/josh/integration` and asserts every changed file is accounted
for by one of the merged `josh/<topic>` branches' own deltas (tooling
files excluded). If integration touches a file no merged patch branch
touches, a merge resolution silently dropped or mangled patch content —
the script fails and you must not push. This is the durable replacement
for the old "eyeball the regenerated tree" step.

## Coordinating across worktrees / machines

Integration is shared mutable state. Before pushing:

- `git pull --ff-only origin josh/integration` (or merge) first —
  never reset/force a regenerated tree over a parallel maintainer's
  durable resolutions.
- Include every already-merged patch (this file is the source of
  truth for "what's live"); don't drop work that's already deployed.
- Update this file in the same change so the next reader sees the truth.
