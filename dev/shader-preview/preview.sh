#!/usr/bin/env bash
# Live-reload harness for the chrome_hexrain shader.
#
# Watches chrome_hexrain.frag and recompiles to .qsb on save (qsb tool from
# qt6.qtshadertools, vendored in via nix-shell). The QML scene watches both
# uniforms.json and the .qsb file independently — this script is only the
# .frag→.qsb compiler and the quickshell launcher.
#
# WARNING: this overwrites the production .qsb in-tree. That's intentional —
# the .qsb is committed alongside the .frag, so iterating here naturally
# stages both for commit. `git checkout` reverts.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

readonly FRAG="../../quickshell/Shaders/frag/chrome_hexrain.frag"
readonly QSB="../../quickshell/Shaders/qsb/chrome_hexrain.frag.qsb"
readonly QML="ShaderPreview.qml"

if [[ ! -f $FRAG ]]; then
    echo "preview.sh: cannot find $FRAG (relative to $(pwd))" >&2
    exit 1
fi

# Pull qsb + inotifywait into the env once. After first fetch they're in the
# nix store; subsequent runs are instant.
export NIX_SHELL_PACKAGES="qt6.qtshadertools inotify-tools"

compile() {
    if nix-shell -p qt6.qtshadertools --run "qsb --qt6 -o '$QSB' '$FRAG'" 2>&1; then
        printf '\033[32m[%s]\033[0m  recompiled %s\n' "$(date +%H:%M:%S)" "$FRAG"
    else
        printf '\033[31m[%s]\033[0m  qsb failed — keeping previous %s\n' "$(date +%H:%M:%S)" "$QSB" >&2
    fi
}

# Ensure we start with a fresh build so what's on screen reflects the .frag,
# not whatever was last committed.
compile

# Launch quickshell on our standalone QML scene. -p takes a direct file path.
quickshell -p "$QML" &
readonly QS_PID=$!

# Tear down quickshell on any exit path. We don't trust quickshell to clean up
# its own process group, so SIGTERM here covers Ctrl-C, error exit, and EOF on
# inotifywait.
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

# .frag watcher loop. inotifywait emits one line per save; the JSON path is
# watched by QML directly via FileView, so this loop only handles GLSL.
nix-shell -p inotify-tools --run "
    inotifywait -m -e close_write,move_self '$FRAG' 2>/dev/null
" | while read -r _; do
    compile
done
