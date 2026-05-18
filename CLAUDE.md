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
  below). It's `master` + persistent tooling commits (`CLAUDE.md`,
  `INTEGRATION.md`, `.gitignore`, `scripts/integration-check`) + a
  maintained stack of `--no-ff` merges of every patch branch we want
  gnomon running today. **It is maintained, not regenerated**: add or
  update a patch by merging its branch in and resolving conflicts once
  — the resolution is a durable commit that exists on every clone, with
  no machine-local rerere cache and no reset-to-`master` re-derivation.
  Remove a patch by reverting its merge commit. The merged set +
  upstream status is documented in `INTEGRATION.md` — update it in the
  same change. Run `scripts/integration-check` (the oracle gate) before
  every push: the integration delta must be exactly the merged patch
  branches' own deltas, nothing else. **If a parallel worktree/machine
  also maintains integration, `git pull --ff-only` then merge into it —
  never reset/force a regenerated tree over it; that silently drops
  durable conflict resolutions.** Patch branches still branch off
  `master`, so upstream PRs stay clean by construction.

When making edits, know which tier you're on: feature/patch work
belongs on a `josh/<topic>` branch off `master`; tooling/docs commits
belong on `josh/integration` only.

### Why patches branch off `master`, not integration

A `josh/<topic>` branched off `master` is, unchanged, the upstream PR:
it carries only its own change, never the tooling commits or other
patches. Branching off integration would mean every PR needed a
`rebase --onto master` strip step before it was submittable — a
self-inflicted dance. Keep patches rooted at `master`. **Do not
introduce a `pr/<topic>` concept or a `prepare-pr` step.**

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

`programs.dank-material-shell` (home-manager) on gnomon resolves to
this source; DMS's HM activation reloads the running shell on rebuild.

**Canonical deploy flow:**
1. Land work on a `josh/<topic>` branch off `master` and push.
2. Merge it into `josh/integration` (see "Maintaining integration").
3. `git push origin josh/integration` (plain push — *not* `-f`).
4. In `~/nix-config`: `nix flake update dank-material-shell` → commit
   the lock bump.
5. On gnomon: `update`. DMS's home-manager activation reloads the
   shell — brief bar flicker, no logout required.

**Always test stacked, never in isolation.** `nix-config`'s
`dank-material-shell.url` always points at `josh/integration`. To
validate a patch, merge it into integration on top of every other live
patch and rebuild gnomon. Do NOT flip the input to a single patch
branch for bisect/isolation testing — that hides interactions between
patches. To find which of N patches caused a regression, revert
suspects' merge commits one at a time, not by repointing the input.

### Maintaining integration

`josh/integration` is long-lived. Conflict resolutions are durable
merge commits — never re-derived, never machine-local. Operations:

```sh
git checkout josh/integration
git pull --ff-only origin josh/integration   # never clobber a parallel maintainer

# add or update a patch (re-merging an updated branch only conflicts
# on its new commits — small):
git merge --no-ff origin/josh/<topic>

# sync upstream into the deploy branch:
git merge --no-ff master

# remove a patch (rare — the one awkward op):
git revert -m 1 <merge-commit-of-that-patch>

# update INTEGRATION.md in the same change as any set change:
$EDITOR INTEGRATION.md && git add INTEGRATION.md \
    && git commit -m "INTEGRATION.md: <what changed>"

scripts/integration-check                    # ORACLE GATE — must pass
git push origin josh/integration             # plain push; -f only for history surgery
```

Resolve conflicts preserving **all** sides — never resolve by dropping
a patch's content. `scripts/integration-check` fails the change if the
integration delta touches anything outside the merged branches' own
deltas, which is exactly how a stale or wrong resolution is caught
*before* it ships. Run it before every push.

There is no reset-to-`master` regeneration and no tooling cherry-pick
dance: tooling commits simply live on the branch. If `git push` is
rejected because a parallel maintainer advanced origin, `git pull
--ff-only` (or merge), re-run `scripts/integration-check`, then push
again. Patch branches still branch off `master` and remain the clean
upstream PR unit.

### Anti-patterns (do NOT re-introduce)

- **Reset-to-`master` + cherry-pick-tooling + octopus regeneration of
  integration.** Regeneration has no durable home for conflict
  resolutions and silently drops work across machines/worktrees.
  Integration is *maintained* (see above), not regenerated. There is
  deliberately no `rebase-integration`/`regen` recipe.
- Sharing a machine-local rerere cache between clones to "replay"
  resolutions — durable merge commits are the resolution.
- Pointing `nix-config`'s `dank-material-shell` input at a single
  `josh/<topic>` branch for isolation testing — always test stacked.
- A `pr/<topic>` branch or `prepare-pr` strip step — patches branch
  off `master` and are PR-ready as-is.

## Fork-specific gotchas

- `josh/integration` carries tooling commits (`CLAUDE.md`,
  `INTEGRATION.md`, `.gitignore`, `scripts/integration-check`) that
  must NOT land in upstream PRs. Patch branches branch off `master`
  precisely so they never inherit them; `scripts/integration-check`
  excludes them from the oracle diff.
- When updating from upstream: ff `master` from `upstream/master`,
  `git merge --no-ff master` into `josh/integration`, resolve once
  (durable), re-run the oracle, push.
- The Nix consumption lives downstream in `nix-config`
  (`home-manager/dms/`), not here. Do not add deploy plumbing to this
  repo — bump the `dank-material-shell` flake input and `update`
  gnomon.
- Quickshell exposes notification `hints` as a `QVariantMap`
  (`notif.hints["..."]`); freedesktop hints like `suppress-sound` are
  read there, not as dedicated properties.
