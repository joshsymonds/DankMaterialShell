# Integration manifest

This file documents what `josh/integration` currently includes. It's a
human-maintained snapshot that lives on integration only (not on patch
branches or master), regenerated whenever integration is.

When you re-derive integration via the recipe in `CLAUDE.md`, **update
this file** so the next reader (human or agent) can tell at a glance
what's deployed without spelunking the merge graph.

## Patch branches in the current integration

| Branch | Origin | Upstream status | What it does |
|---|---|---|---|
| `josh/chrome-shader` | local | Not yet PRed upstream | The big chrome+wallpaper overhaul. Live-rendered wallpaper as a multi-monitor canvas with the "hexrain" scene (continuous-direction cast shadows, palette-flip wave, dynamic sun counts, bar-zone elevation/anchor, per-output activation). Includes ShaderSceneEditor for live iteration (toggleable). Adds `Theme.widgetBackgroundColor = "scl"` (surfaceContainerLowest) and a `barConfig.widgetPill` toggle for capsule-shaped chrome. SceneStateService writes to an XDG state shadow so saves persist without polluting the source. |
| `josh/wider-pills` | local | Not yet PRed upstream | Single-line change to `Modules/DankBar/DankBarWindow.qml`: bumps `widgetThickness` base from `26` to `36`. Combined with `innerPadding=0` in the user's `barConfigs`, pills go from ~28px to ~36px wide while the bar stays at 40px — eliminates the "pills floating in a wide channel" look. |
| `josh/icon-cleanup` | local | Not yet PRed upstream | `RamMonitor.qml`: icon `developer_board` → `memory_alt`. Visually `developer_board` (PCB with chips) reads as a graphics card / motherboard, not a RAM stick; `memory_alt` (rectangle with vertical bars + connector pegs) is the DIMM-shaped icon. Frees `developer_board` for downstream GPU plugins (dms-gpu-pill) to use without clashing with the CPU's `memory` icon. |

## Tooling commit

Single commit at the base of integration (after `master`) carries
everything that should NOT bleed into upstream PRs:

- `CLAUDE.md` — agent guide explaining the branch model + re-derivation
- `INTEGRATION.md` — this file
- `.gitignore` additions — `/worktrees`, `/reference` (out-of-tree dirs
  for git worktrees and prior-art reference checkouts, if used)

## Coordinating re-derivations across worktrees

If you're working in a `worktrees/<topic>/` subdir, your re-derivation
of `josh/integration` may collide with another worktree's. Always
deploy a patch by re-deriving integration on top of every other live
patch — never point `nix-config`'s `dank-material-shell` input at a
single patch branch. Testing a patch means testing it stacked with
every other deployed patch, not in isolation. Before you force-push
integration:

- Pull `origin/josh/integration` first, identify what's currently
  merged, and include those branches in your regen — don't drop work
  that's already deployed.
- Update this file in the same commit so the next reader sees the truth.

## Re-deriving integration

See "Re-deriving integration" in `CLAUDE.md`. The procedure is unchanged
from this manifest; this file just makes the *current* state legible.

When patches are added or removed:

1. Update the table above (branch / origin / upstream / what it does).
2. Bump the lock in `~/nix-config` (`nix flake update dank-material-shell`).
3. `nixos-rebuild switch --flake ~/nix-config#gnomon` and verify the
   bar/widgets still render correctly.
