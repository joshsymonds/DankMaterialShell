# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## Repository identity

This is a personal fork of `AvengeMedia/DankMaterialShell` (a Quickshell-
based desktop shell for niri / Hyprland / other Wayland compositors). The
fork carries a stack of local patches plus an integration branch that
combines them for desktop deployment.

- `origin` → `joshsymonds/DankMaterialShell`
- `upstream` → `AvengeMedia/DankMaterialShell`

## Branch model

Three branch tiers, each with one job:

- **`master`** — fast-forward only from `upstream/master`. Never merge
  into it. To update: `git fetch upstream && git checkout master &&
  git merge --ff-only upstream/master && git push origin master`.
- **`josh/<topic>`** — feature/patch branches branched **directly off
  `master`**. Each holds one logically separable change. **The branch
  *is* the upstream PR** — push it and open a PR from
  `joshsymonds/DankMaterialShell:josh/<topic>` into
  `AvengeMedia/DankMaterialShell:master`. No rebase/cleanup dance.
- **`josh/integration`** — the deploy artifact (see "Deploy model"
  below). It's `master` + a tooling commit (`CLAUDE.md`,
  `INTEGRATION.md`, `.gitignore` additions) + an octopus (or sequential)
  merge of every patch branch we want gnomon running today. **It is
  regenerated, not maintained**: when patches change or new ones land,
  hard-reset integration to master and re-run the recipe in
  "Re-deriving integration" below. The current set of merged patches
  and their upstream status is documented in `INTEGRATION.md` — keep
  it in sync when you re-derive.

When making edits, know which tier you're on: feature/patch work
belongs on a `josh/<topic>` branch off `master`; tooling/docs commits
belong on `josh/integration` only (and survive integration
regeneration via cherry-pick or by re-running the tooling-commit step).

### Deploy model (downstream consumers)

`josh/integration` is the deploy artifact for the user's NixOS desktop
(`gnomon`). The user's `nix-config` repo pins it as a flake input:

```nix
# ~/nix-config/flake.nix
dank-material-shell = {
  url = "github:joshsymonds/DankMaterialShell/josh/integration";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

**Canonical deploy flow:**
1. Land work on a `josh/<topic>` branch off `master` and push.
2. Re-derive `josh/integration` (see below) so it includes the new
   branch.
3. `git push -f origin josh/integration`.
4. In `~/nix-config`: `nix flake update dank-material-shell` → commit
   the lock bump → push.
5. On gnomon: `update` (or `nixos-rebuild switch --flake
   ~/nix-config#gnomon`). DMS's home-manager activation reloads the
   shell — brief bar flicker, no logout required.

**Always test stacked, never in isolation.** `nix-config`'s
`dank-material-shell.url` always points at `josh/integration`. To
validate a patch, re-derive integration with that patch included on
top of every other live patch and rebuild gnomon. Do NOT flip the
input to a single patch branch for bisect/isolation testing — that
hides interactions between patches.

### Re-deriving integration

```bash
# From the repo root, with a clean working tree:
git fetch origin

# 1. Start fresh on master
git checkout josh/integration
git reset --hard origin/master

# 2. Tooling commit
#    (If CLAUDE.md / INTEGRATION.md / .gitignore additions are absent
#    after the reset — they should be, since they live only on
#    integration — re-create them. Easiest: cherry-pick the prior
#    tooling commit:)
git cherry-pick <sha-of-previous-tooling-commit>

# 3. Octopus merge every active patch branch into integration
#    (Use --no-ff so the merge structure is preserved; --no-edit
#    skips opening $EDITOR for the auto-generated merge message.)
git merge --no-ff --no-edit \
    origin/josh/chrome-shader \
    origin/josh/wider-pills

# If octopus fails on conflicts, fall back to sequential:
#   git merge --no-ff --no-edit origin/josh/chrome-shader
#   git merge --no-ff --no-edit origin/josh/wider-pills
# Resolve, commit, continue.

# 4. Update INTEGRATION.md to reflect any branch list changes.
$EDITOR INTEGRATION.md
git add INTEGRATION.md
git commit --amend  # or new commit; either works

# 5. Push
git push -f origin josh/integration
```

Then in `~/nix-config`:

```bash
cd ~/nix-config
nix flake update dank-material-shell
git add flake.lock
git commit -m 'flake.lock: bump dank-material-shell (re-derive integration)'
update
```

### Why not just maintain integration like a regular branch?

The same logic as the niri fork: integration is a *view* of which
patches are deployed, not a source of truth. Patches evolve, get
rebased onto newer master, get merged upstream and then dropped from
the deploy set. Reconstructing integration from scratch each time
keeps the merge graph clean and makes "which patches are live"
trivially answerable by reading `INTEGRATION.md`.
