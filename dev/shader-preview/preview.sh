#!/usr/bin/env bash
# Live-reload harness for the chrome_hexrain shader.
#
# Watches chrome_hexrain.frag and recompiles to .qsb on save. The QML scene
# watches uniforms.json and the .qsb independently — this script is the
# .frag→.qsb compiler and the quickshell launcher.
#
# Watch strategy: nix-shell is entered ONCE at the top so qsb + inotifywait
# are on PATH for the whole session (re-entering per-event added pipe
# buffering that swallowed close_write events). The .frag is watched via its
# parent directory rather than the file directly, because editors (and Edit
# tools) commonly do atomic rename-over which detaches a file-level watch.
#
# WARNING: overwrites the production .qsb in-tree. Intentional — .qsb is
# committed alongside .frag, so iterating here stages both. `git checkout`
# reverts.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

readonly FRAG="../../quickshell/Shaders/frag/chrome_hexrain.frag"
readonly QSB="../../quickshell/Shaders/qsb/chrome_hexrain.frag.qsb"
readonly QML="ShaderPreview.qml"

if [[ ! -f $FRAG ]]; then
    echo "preview.sh: cannot find $FRAG (relative to $(pwd))" >&2
    exit 1
fi

# Re-exec inside nix-shell once so qsb + inotifywait stay on PATH for the
# rest of the script. Subsequent invocations are instant (nix store cache).
if [[ -z "${INSIDE_PREVIEW_NIX_SHELL:-}" ]]; then
    export INSIDE_PREVIEW_NIX_SHELL=1
    exec nix-shell -p qt6.qtshadertools inotify-tools --run "$0 $*"
fi

readonly FRAG_DIR="$(dirname "$FRAG")"
readonly FRAG_NAME="$(basename "$FRAG")"

compile() {
    if qsb --qt6 -o "$QSB" "$FRAG" 2>&1; then
        printf '\033[32m[%s]\033[0m  recompiled %s\n' "$(date +%H:%M:%S)" "$FRAG"
    else
        printf '\033[31m[%s]\033[0m  qsb failed — keeping previous %s\n' "$(date +%H:%M:%S)" "$QSB" >&2
    fi
}

# Fresh build so on-screen reflects the .frag, not whatever was last committed.
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
printf '  Edit \033[36m%s\033[0m or \033[36m%s\033[0m and save.\n' \
    "uniforms.json" "$(realpath --relative-to="$PWD" "$FRAG")"
printf '  Ctrl-C to exit.\n\n'

# Watch parent directory, filter by filename. Catches both write-in-place
# (close_write) and atomic-rename (moved_to) edit styles. --monitor keeps it
# alive across consecutive saves. stdbuf -oL forces line-buffered output so
# events propagate to the read loop without pipe-buffer delays.
stdbuf -oL inotifywait -m -e close_write,moved_to --format '%f' "$FRAG_DIR" 2>/dev/null |
while read -r changed; do
    if [[ "$changed" == "$FRAG_NAME" ]]; then
        compile
    fi
done
