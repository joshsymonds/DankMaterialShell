#!/usr/bin/env bash
# Live-reload harness for the chrome_hexrain shader.
#
# Watches the chrome_hexrain shaders (main pass + cell and light pre-passes)
# and recompiles all three to .qsb when any of them is saved. The QML scene
# watches uniforms.json and the main .qsb independently (a reload re-fetches
# all three) — this script is the .frag→.qsb compiler and the quickshell
# launcher.
#
# Watch strategy: nix-shell is entered ONCE at the top so qsb + inotifywait
# are on PATH for the whole session (re-entering per-event added pipe
# buffering that swallowed close_write events). The .frags are watched via
# their parent directory rather than the files directly, because editors (and
# Edit tools) commonly do atomic rename-over which detaches a file-level watch.
#
# WARNING: overwrites the production .qsbs in-tree. Intentional — .qsb is
# committed alongside .frag, so iterating here stages both. `git checkout`
# reverts.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

readonly FRAG_DIR="../../quickshell/Shaders/frag"
readonly QSB_DIR="../../quickshell/Shaders/qsb"
readonly SHADERS=(chrome_hexrain_cells chrome_hexrain_light chrome_hexrain)
readonly QML="ShaderPreview.qml"

for s in "${SHADERS[@]}"; do
    if [[ ! -f $FRAG_DIR/$s.frag ]]; then
        echo "preview.sh: cannot find $FRAG_DIR/$s.frag (relative to $(pwd))" >&2
        exit 1
    fi
done

# Re-exec inside nix-shell once so qsb + inotifywait stay on PATH for the
# rest of the script. Subsequent invocations are instant (nix store cache).
if [[ -z "${INSIDE_PREVIEW_NIX_SHELL:-}" ]]; then
    export INSIDE_PREVIEW_NIX_SHELL=1
    exec nix-shell -p qt6.qtshadertools inotify-tools --run "$0 $*"
fi

# Compiles every shader; the main pass goes last so the scene's reload
# (triggered by the main .qsb changing) sees fresh pre-pass .qsbs too.
compile() {
    for s in "${SHADERS[@]}"; do
        if qsb --qt6 -o "$QSB_DIR/$s.frag.qsb" "$FRAG_DIR/$s.frag" 2>&1; then
            printf '\033[32m[%s]\033[0m  recompiled %s.frag\n' "$(date +%H:%M:%S)" "$s"
        else
            printf '\033[31m[%s]\033[0m  qsb failed — keeping previous %s.frag.qsb\n' "$(date +%H:%M:%S)" "$s" >&2
        fi
    done
}

# Fresh build so on-screen reflects the .frags, not whatever was last committed.
compile

quickshell -p "$QML" &
readonly QS_PID=$!

cleanup() {
    if kill -0 "$QS_PID" 2>/dev/null; then
        kill "$QS_PID" 2>/dev/null || true
        wait "$QS_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

printf '\n'
printf '  \033[1mShader preview running.\033[0m  pid=%s\n' "$QS_PID"
printf '  Edit \033[36m%s\033[0m or any \033[36m%s/chrome_hexrain*.frag\033[0m and save.\n' \
    "uniforms.json" "$(realpath --relative-to="$PWD" "$FRAG_DIR")"
printf '  Ctrl-C to exit.\n\n'

# Watch parent directory, filter by filename. Catches both write-in-place
# (close_write) and atomic-rename (moved_to) edit styles. --monitor keeps it
# alive across consecutive saves. stdbuf -oL forces line-buffered output so
# events propagate to the read loop without pipe-buffer delays.
stdbuf -oL inotifywait -m -e close_write,moved_to --format '%f' "$FRAG_DIR" 2>/dev/null |
while read -r changed; do
    case "$changed" in
    chrome_hexrain.frag | chrome_hexrain_cells.frag | chrome_hexrain_light.frag)
        compile
        ;;
    esac
done
