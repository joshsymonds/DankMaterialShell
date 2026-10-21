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

Upstream base: `master` = upstream `3284acab` (Dux Shell v2.0.0,
2026-10-20). Every live patch branch below has `master` merged in and
is ported to the post-2.0 layout.

| Branch | Origin | Upstream status | What it does |
|---|---|---|---|
| `josh/chrome-shader` | local | Not yet PRed upstream | The big chrome+wallpaper overhaul. Live-rendered wallpaper (`ShaderWallpaperBackground`, swapped in for `WallpaperBackground` in `shell.qml`'s wallpaper scope) as a multi-monitor canvas with the "hexrain" scene (continuous-direction cast shadows, palette-flip wave, dynamic sun counts, bar-zone elevation/anchor, per-output activation). Includes ShaderSceneEditor for live iteration (toggleable). Bar shader overlay in `Modules/DBar/BarSurface.qml` (`barConfig.shader*` keys, masked to the bar body + goth wings; unknown modes like `"none"` create no ShaderEffect and no frame clock). Adds `Theme.widgetBackgroundColor = "scl"` (surfaceContainerLowest — note upstream's generic color keys now use `scl` = Low, `scll` = Lowest) and a `barConfig.widgetPill` toggle for capsule-shaped chrome in `Modules/SurfaceWidgets/BarPill.qml`. Notification click focuses the originating niri window (`NiriService.focusSourceForNotification`). SceneStateService writes to an XDG state shadow (`$XDG_STATE_HOME/dms/scenes`) so saves persist without polluting the source. `Theme.tertiary` and the cross-monitor fullscreen-detection fix it used to carry are upstream now. |
| `josh/wider-pills` | local | Not yet PRed upstream | `Theme.barWidgetThickness`: widget thickness base `26` → `36` (upstream centralized the formula there; `Theme.barThickness` derives from it, so the bar is 40px at `innerPadding=0`). Combined with `innerPadding=0` in the user's `barConfigs`, pills go from ~28px to ~36px wide — eliminates the "pills floating in a wide channel" look. |
| `josh/icon-cleanup` | local | Not yet PRed upstream | `Modules/DBar/Widgets/RamMonitor.qml`: icon `developer_board` → `memory_alt`. `developer_board` (PCB with chips) reads as a graphics card, not a RAM stick; `memory_alt` (DIMM-shaped) is correct. Frees `developer_board` for downstream GPU plugins (dms-gpu-pill) without clashing with the CPU's `memory` icon. |
| `josh/osd-labels` | local | Not yet PRed upstream | `Widgets/OSDLabeledContent.qml` + `LevelOSD.title`: Volume/MicVolume/MediaVolume/Brightness OSDs show which sink, source, MPRIS player or display they adjust. Ported from five commits that were made directly on integration before upstream's LevelOSD rewrite. |
| `josh/greeter-transparent-bg` | local | Not yet PRed upstream | `greeterTransparentBackground` setting (SettingsSpec/SettingsData, re-exposed by `GreetdSettings`): the greeter paints no wallpaper Image and no dim layer, so a host compositor that paints its own wallpaper (halmasuit) shows through. Ported from a commit made directly on integration. |
| `josh/notif-suppress-sound` | local | **Upstreamed** as #2440 (merged 2026-05-18) | Honored the freedesktop `suppress-sound` hint in `NotificationService.qml`. Upstream's version (which also honors `sound-name`) is now in `master`, so this merge contributes nothing; retire it with `git revert -m 1` on its integration merge when convenient (the branch was left un-ported). |

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

Run before every push. It diffs integration against `origin/master`
(every file where integration differs from upstream) and asserts each
one is accounted for by one of the merged `josh/<topic>` branches' own
deltas (tooling files excluded). Upstream content that integration
merely carries is identical to master and drops out, so an upstream
sync is checked the same way as a patch merge — push `master` first.
If integration differs from master in a file no merged patch branch
touches, a merge resolution silently dropped or mangled content — the
script fails and you must not push. This is the durable replacement
for the old "eyeball the regenerated tree" step. (Until 2026-10-20 it
diffed against `origin/josh/integration`, which flagged every upstream
file on a sync and could never pass one.)

## Coordinating across worktrees / machines

Integration is shared mutable state. Before pushing:

- `git pull --ff-only origin josh/integration` (or merge) first —
  never reset/force a regenerated tree over a parallel maintainer's
  durable resolutions.
- Include every already-merged patch (this file is the source of
  truth for "what's live"); don't drop work that's already deployed.
- Update this file in the same change so the next reader sees the truth.
