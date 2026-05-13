#!/usr/bin/env bash
# Reads uniforms.json (new schema: { shader: {...}, harness: {...} }) and
# prints the corresponding nix snippet for nix-config:
# home-manager/dms/default.nix barConfigs[0]. Paste-ready.
#
# Mapping (chrome_hexrain): shader.<uniformName> → nix.<niKey>
#   shader.cellSize             → shaderHexSize  (rounded to int)
#   shader.colorPrimary         → shaderPrimaryColor
#   shader.colorSecondary       → shaderSecondaryColor
#   shader.colorPrimaryContainer → shaderPrimaryContainerColor
#   shader.colorTertiary        → shaderTertiaryColor
#
# Notes:
#   - shader.intensity is NOT mapped: BarCanvas.qml hardcodes intensity=1.0
#     for hexrain mode. If you've tuned it, this script warns.
#   - harness.speed is NOT mapped: BarCanvas.qml hardcodes speed=1.0.
#   - To support a different shader (e.g. chrome_aurora) extend the mapping
#     section below.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

if [[ ! -f uniforms.json ]]; then
    echo "to-nix.sh: uniforms.json missing in $(pwd)" >&2
    exit 1
fi

read_field() {
    jq -r "$1" uniforms.json
}

intensity=$(read_field '.shader.intensity')
cellSize=$(read_field '.shader.cellSize')
primary=$(read_field '.shader.colorPrimary')
secondary=$(read_field '.shader.colorSecondary')
primaryContainer=$(read_field '.shader.colorPrimaryContainer')
tertiary=$(read_field '.shader.colorTertiary')
speed=$(read_field '.harness.speed')

cellSizeInt=$(printf '%.0f' "$cellSize")

cat <<EOF
# Paste into home-manager/dms/default.nix barConfigs[0] — replace existing shader* fields.

shaderMode = "hexrain";
shaderHexSize = ${cellSizeInt};

shaderPrimaryColor = "${primary}";
shaderSecondaryColor = "${secondary}";
shaderPrimaryContainerColor = "${primaryContainer}";
shaderTertiaryColor = "${tertiary}";
EOF

if [[ "$intensity" != "1.0" && "$intensity" != "1" ]]; then
    echo
    echo "# WARNING: shader.intensity=${intensity} is not expressible — BarCanvas.qml hardcodes 1.0 for hexrain." >&2
fi

if [[ "$speed" != "1.0" && "$speed" != "1" ]]; then
    echo
    echo "# WARNING: harness.speed=${speed} is not expressible — BarCanvas.qml hardcodes 1.0." >&2
fi
