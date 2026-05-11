import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io

// Standalone Quickshell scene for iterating on a chrome-family shader (currently
// chrome_hexrain — chrome_aurora shares the same uniforms and would slot in by
// changing the FRAG/QSB constants in preview.sh).
//
// Two paths to mutate state:
//   1. Edit dev/shader-preview/uniforms.json in your text editor → save → live.
//   2. Drag sliders / type hex codes in the right-hand panel → click Save when
//      satisfied. Both paths converge on uniforms.json as the source of truth.
//
// Schema (uniforms.json):
//   {
//     "shader":  { <uniformName>: <number|hexString>, ... },   // GPU uniforms
//     "harness": { <knob>: <number>, ... }                     // QML-only
//   }
// Keys under `shader` must match the std140 uniform-block variable names in
// the .frag exactly — they're assigned to the ShaderEffect by name lookup.
// To preview a different shader: declare its uniforms as properties on the
// ShaderEffect below, point preview.sh at the new .frag/.qsb, restart.
//
// Window layout:
//   ┌─────────────────────────────────────────┬───────────────────┐
//   │ chrome strip                            │                   │
//   ├─────────────────────────────────────────┤   control panel   │
//   │                                         │                   │
//   │ shader region                           │   ...sliders...   │
//   │                                         │   ...colors...    │
//   │                                         │   [Save]          │
//   └─────────────────────────────────────────┴───────────────────┘
FloatingWindow {
    id: root

    // ===== Path resolution =====

    readonly property string harnessDir: {
        let u = Qt.resolvedUrl(".").toString();
        if (u.startsWith("file://")) u = u.substring(7);
        if (!u.endsWith("/")) u += "/";
        return u;
    }
    readonly property string uniformsPath: harnessDir + "uniforms.json"
    readonly property string qsbPath: harnessDir + "../../quickshell/Shaders/qsb/chrome_hexrain.frag.qsb"

    // ===== Live state =====

    // Mirrors the on-disk JSON. Updated on file load AND on slider/color
    // changes from the panel; persisted back to disk via Save.
    property var shaderState: ({})
    property var harnessState: ({})

    // True when the in-memory state diverges from disk. Drives the Save
    // button label so the user knows they have unsaved changes.
    property bool dirty: false

    // Visible reload counters (chrome strip).
    property int uniformsRev: 0
    property int qsbRev: 0

    // Per-knob hint table for slider bounds. Add entries here for new known
    // uniforms; unknown numeric keys fall back to (0, 2, 0.01).
    readonly property var hints: ({
        "intensity":      { min: 0.0, max: 1.0, step: 0.01 },
        "cellSize":       { min: 4,   max: 40,  step: 1    },
        "speed":          { min: 0.0, max: 3.0, step: 0.05 },
        "modeAmount":     { min: 0.0, max: 1.0, step: 0.01 },
        "domeStrength":   { min: 0.0, max: 1.0, step: 0.01 },
        "seamGlow":       { min: 0.0, max: 3.0, step: 0.02 },
        "sunDriftSpeed":  { min: 0.0, max: 3.0, step: 0.05 },
        "heightAmount":   { min: 0.0, max: 1.0, step: 0.01 },
        "matteness":      { min: 0.0, max: 1.0, step: 0.01 },
        "bleedBack":      { min: 0.0, max: 0.3, step: 0.005 },
        "hexBevel":       { min: 0.0, max: 1.0, step: 0.01 },
        "heightDriftSpeed": { min: 0.0, max: 3.0, step: 0.05 },
        "frontSunStrength": { min: 0.0, max: 5.0, step: 0.02 },
        "frontSunSpeed":    { min: 0.0, max: 12.0, step: 0.1 },
        "frontSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "frontSunShadowLength":   { min: 0.0, max: 4.0, step: 0.05 },
        "frontSunShadowDarkness": { min: 0.0, max: 3.0, step: 0.02 },
        "backSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "backSunStrength": { min: 0.0, max: 3.0, step: 0.02 },
        "backNegSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "backNegSunStrength": { min: 0.0, max: 1.0, step: 0.01 },
        "backNegSunSpeed":    { min: 0.0, max: 5.0, step: 0.05 },
        "backSunPaletteSpeed":  { min: 0.0, max: 3.0, step: 0.02 },
        "frontSunPaletteSpeed": { min: 0.0, max: 3.0, step: 0.02 },
        "backSunCount":      { min: 0, max: 10, step: 1 },
        "backNegSunCount":   { min: 0, max: 10, step: 1 },
        "frontSunCount":     { min: 0, max: 10, step: 1 },
        "frontNegSunCount":  { min: 0, max: 10, step: 1 },
        "frontNegSunStrength": { min: 0.0, max: 1.0, step: 0.01 },
        "frontNegSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "frontNegSunSpeed":    { min: 0.0, max: 12.0, step: 0.1 },
        "flipPropDelay":  { min: 0.0, max: 0.5, step: 0.005 },
        "flipDuration":   { min: 0.05, max: 3.0, step: 0.05 },
        "depthShading":   { min: 0.0, max: 1.0, step: 0.01 },
        "flipSpecular":   { min: 0.0, max: 3.0, step: 0.02 },
        "hexDepth":       { min: 0.0, max: 1.5, step: 0.02 }
    })

    // Section grouping: a fixed-order list of named sections, each with the
    // uniform keys it owns. Any key not in this map falls into a "misc"
    // bucket so newly-added uniforms still show up rather than vanish.
    readonly property var sectionMap: ([
        { name: "field", keys: [
            "intensity", "cellSize", "modeAmount", "domeStrength", "seamGlow",
            "sunDriftSpeed", "heightAmount", "matteness", "bleedBack",
            "hexBevel", "heightDriftSpeed", "depthShading", "hexDepth"
        ] },
        { name: "front sun", keys: [
            "frontSunCount", "frontSunStrength", "frontSunSpeed", "frontSunSize",
            "frontSunShadowLength", "frontSunShadowDarkness", "frontSunPaletteSpeed"
        ] },
        { name: "negative front sun", keys: [
            "frontNegSunCount", "frontNegSunStrength", "frontNegSunSize",
            "frontNegSunSpeed"
        ] },
        { name: "back sun", keys: [
            "backSunCount", "backSunSize", "backSunStrength", "backSunPaletteSpeed"
        ] },
        { name: "negative back sun", keys: [
            "backNegSunCount", "backNegSunSize", "backNegSunStrength",
            "backNegSunSpeed"
        ] },
        { name: "colors", keys: [
            "colorPrimary", "colorSecondary", "colorPrimaryContainer", "colorTertiary"
        ] },
        { name: "flip target", keys: [
            "colorPrimaryNext", "colorSecondaryNext",
            "colorPrimaryContainerNext", "colorTertiaryNext",
            "flipPropDelay", "flipDuration", "flipSpecular"
        ] },
        { name: "harness", keys: ["speed"] }
    ])

    // Built per-load; each entry is { name, controls: [...] }. Controls
    // share the same shape as before so the slider/color delegates can
    // be reused unchanged.
    property var sections: []

    // Per-section expand/collapse state. Missing keys default to expanded
    // via the `!== false` check at render time.
    property var expanded: ({})

    // ===== Window setup =====

    title: "Shader Preview — chrome_hexrain"
    minimumSize: Qt.size(700, 200)
    color: "#0a0a0a"
    implicitWidth: 1600
    implicitHeight: 420

    // ===== State plumbing =====

    function applyState() {
        // Push shaderState values into the ShaderEffect's named properties.
        // Hex strings are converted to vec4. Names that don't match a property
        // on shaderEffect are silently skipped (so you can park future-shader
        // uniforms in JSON without breaking anything).
        for (const k in shaderState) {
            if (k.startsWith("_")) continue;
            const v = shaderState[k];
            if (!Object.prototype.hasOwnProperty.call(shaderEffect, k))
                continue;
            if (typeof v === "string" && v.startsWith("#")) {
                const c = Qt.color(v);
                shaderEffect[k] = Qt.vector4d(c.r, c.g, c.b, c.a);
            } else if (typeof v === "number") {
                shaderEffect[k] = v;
            }
        }
    }

    function buildCtrl(section, key, v) {
        const h = hints[key];
        if (typeof v === "number") {
            return {
                section: section, key: key, kind: "real", value: v,
                minVal: h ? h.min : 0,
                maxVal: h ? h.max : (section === "harness" ? 3 : 2),
                step:   h ? h.step : (section === "harness" ? 0.05 : 0.01)
            };
        } else if (typeof v === "string" && v.startsWith("#")) {
            return { section: section, key: key, kind: "color", value: v };
        }
        return null;
    }

    // Internal-state uniforms that should never appear as panel rows
    // even if they live in shaderState (so applyState pushes them).
    readonly property var hiddenKeys: ({
        "flipStartTime": true,
        "flipOriginX": true,
        "flipOriginY": true
    })

    function rebuildSections() {
        const known = {};
        for (let i = 0; i < sectionMap.length; i++) {
            for (let j = 0; j < sectionMap[i].keys.length; j++) {
                known[sectionMap[i].keys[j]] = true;
            }
        }
        // Mark hidden keys as "known" so they don't fall into misc.
        for (const k in hiddenKeys) known[k] = true;
        const result = [];
        for (let i = 0; i < sectionMap.length; i++) {
            const s = sectionMap[i];
            const ctrls = [];
            for (let j = 0; j < s.keys.length; j++) {
                const k = s.keys[j];
                let c = null;
                if (k in shaderState)       c = buildCtrl("shader", k, shaderState[k]);
                else if (k in harnessState) c = buildCtrl("harness", k, harnessState[k]);
                if (c) ctrls.push(c);
            }
            if (ctrls.length > 0) result.push({ name: s.name, controls: ctrls });
        }
        // Misc bucket: anything not assigned to a known section.
        const misc = [];
        for (const k in shaderState) {
            if (k.startsWith("_") || known[k]) continue;
            const c = buildCtrl("shader", k, shaderState[k]);
            if (c) misc.push(c);
        }
        for (const k in harnessState) {
            if (k.startsWith("_") || known[k]) continue;
            const c = buildCtrl("harness", k, harnessState[k]);
            if (c) misc.push(c);
        }
        if (misc.length > 0) result.push({ name: "misc", controls: misc });
        sections = result;
    }

    function toggleSection(name) {
        const cur = (expanded[name] !== false);
        const next = Object.assign({}, expanded);
        next[name] = !cur;
        expanded = next;
    }

    // Palette flip — sets the wave origin to a random screen position,
    // stamps flipStartTime with the current iTime, and arms a timer
    // that commits the new body colour once the wave has passed every
    // hex. Lockout while flipActive prevents mid-flip re-trigger from
    // making the field discontinuous.
    property bool flipActive: false

    function triggerFlip() {
        if (flipActive) return;
        const w = shaderEffect.width;
        const h = shaderEffect.height;
        const ox = Math.random() * w;
        const oy = Math.random() * h;
        const propDelay = shaderState["flipPropDelay"] !== undefined
                        ? shaderState["flipPropDelay"] : 0.05;
        const duration = shaderState["flipDuration"] !== undefined
                       ? shaderState["flipDuration"] : 0.5;
        const cellSize = shaderState["cellSize"] !== undefined
                       ? shaderState["cellSize"] : 14;
        // Worst-case hex distance from origin to the farthest corner.
        const maxDist = Math.sqrt(
            Math.max(ox, w - ox) * Math.max(ox, w - ox) +
            Math.max(oy, h - oy) * Math.max(oy, h - oy));
        const pitch = Math.max(cellSize * 1.7320508, 1.0);
        // totalSec is in iTime-seconds (how long the wave takes to
        // fully traverse, measured by the cell-flip phase math).
        const totalSec = (maxDist / pitch) * propDelay + duration;
        // Wall-clock duration depends on the harness speed multiplier
        // applied to iTime. If speed=0.5, iTime advances at half-rate
        // and the wave takes 2× as long in real time. Without this
        // correction the timer commits before the wave actually
        // finishes — visible as the wave terminating abruptly when
        // the leading edge is still on-screen.
        const speed = root.harnessState.speed !== undefined ? root.harnessState.speed : 1.0;
        // Wall-clock = totalSec / speed seconds, + 200ms buffer.
        // The buffer guarantees iTime is well past flipStartTime+totalSec
        // when commit fires; without it, frame-timing jitter can leave
        // the last few cells/suns at phase < 1, causing a visible snap
        // when the palette swap and flipStartTime reset happen.
        const wallClockMs = totalSec * 1000.0 / Math.max(speed, 0.01) + 200.0;

        shaderState["flipOriginX"] = ox;
        shaderState["flipOriginY"] = oy;
        shaderState["flipStartTime"] = shaderEffect.iTime;
        shaderState = shaderState;
        applyState();
        flipActive = true;
        flipCommitTimer.interval = Math.max(50, wallClockMs);
        flipCommitTimer.start();
    }

    Timer {
        id: flipCommitTimer
        repeat: false
        onTriggered: {
            // Swap all four Current/Next palette pairs so a successive
            // Trigger flip click animates the field back to the
            // previous colours rather than nothing. Both body tint
            // AND sun palette entries get swapped now that the wave
            // drives sun colours too (step 2).
            const pairs = [
                ["colorPrimary",          "colorPrimaryNext"],
                ["colorSecondary",        "colorSecondaryNext"],
                ["colorPrimaryContainer", "colorPrimaryContainerNext"],
                ["colorTertiary",         "colorTertiaryNext"]
            ];
            for (let i = 0; i < pairs.length; i++) {
                const cur = root.shaderState[pairs[i][0]];
                const nxt = root.shaderState[pairs[i][1]];
                if (cur !== undefined && nxt !== undefined) {
                    root.shaderState[pairs[i][0]] = nxt;
                    root.shaderState[pairs[i][1]] = cur;
                }
            }
            // Reset to the future sentinel so per-hex flip phase
            // clamps back to 0 and the field renders the (newly
            // committed) Current palette cleanly.
            root.shaderState["flipStartTime"] = 1.0e9;
            root.shaderState = root.shaderState;
            root.applyState();
            root.rebuildSections();
            root.flipActive = false;
            root.dirty = true;
        }
    }

    function setValue(section, key, value) {
        const target = (section === "shader") ? shaderState : harnessState;
        target[key] = value;
        // var properties don't deep-watch — re-assign to trigger bindings.
        if (section === "shader") shaderState = shaderState;
        else                      harnessState = harnessState;
        applyState();
        dirty = true;
    }

    function persist() {
        const obj = {
            "_comment": "Live-reloaded by ShaderPreview.qml. Edit + save here, or use the in-window panel and click Save.",
            "_schema": "Keys under .shader MUST match std140 uniform names in the .frag exactly. Keys under .harness drive QML behaviour (not GPU uniforms).",
            "shader": shaderState,
            "harness": harnessState
        };
        uniformsView.ourWrite = true;
        uniformsView.setText(JSON.stringify(obj, null, 2) + "\n");
        dirty = false;
    }

    // ===== File watchers =====

    FileView {
        id: uniformsView
        path: root.uniformsPath
        blockLoading: false
        watchChanges: true

        // True for the brief window between persist() and the resulting
        // onFileChanged firing — prevents an infinite write→reload→write loop.
        property bool ourWrite: false

        onFileChanged: {
            if (ourWrite) {
                ourWrite = false;
                return;
            }
            reload();
        }
        onLoaded: {
            try {
                const j = JSON.parse(text());
                root.shaderState  = j.shader  || {};
                root.harnessState = j.harness || {};
                root.applyState();
                root.rebuildSections();
                root.uniformsRev += 1;
                root.dirty = false;
            } catch (e) {
                console.warn("uniforms.json parse error:", e.message);
            }
        }
        onSaveFailed: function (err) {
            console.warn("uniforms.json save failed:", err);
        }
    }

    FileView {
        id: qsbWatcher
        path: root.qsbPath
        blockLoading: false
        watchChanges: true

        onFileChanged: {
            root.qsbRev += 1;
            reload();
        }
    }

    // ===== Chrome strip (top) =====

    Rectangle {
        id: chromeStrip
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 32
        color: "#181818"
        z: 10

        Row {
            anchors.left: parent.left
            anchors.leftMargin: 10
            anchors.verticalCenter: parent.verticalCenter
            spacing: 16

            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 12; font.bold: true
                text: "chrome_hexrain"
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#9090b0"; font.family: "monospace"; font.pixelSize: 12
                text: "iTime: " + shaderEffect.iTime.toFixed(2) + "s"
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#909090"; font.family: "monospace"; font.pixelSize: 12
                text: "uniforms@" + root.uniformsRev + "  shader@" + root.qsbRev
            }
        }

        Text {
            anchors.right: closeButton.left
            anchors.rightMargin: 12
            anchors.verticalCenter: parent.verticalCenter
            color: "#707070"; font.family: "monospace"; font.pixelSize: 11
            text: "Esc to quit"
        }

        Rectangle {
            id: closeButton
            anchors.right: parent.right
            anchors.rightMargin: 6
            anchors.verticalCenter: parent.verticalCenter
            width: 22; height: 22; radius: 4
            color: closeMouseArea.containsMouse ? "#cc4040" : "#303030"
            border.color: "#505050"; border.width: 1

            Text {
                anchors.centerIn: parent
                text: "×"; color: "#ffffff"; font.pixelSize: 16; font.bold: true
            }
            MouseArea {
                id: closeMouseArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: Qt.quit()
            }
        }
    }

    // ===== Shader region (left) =====

    ShaderEffect {
        id: shaderEffect
        anchors.left: parent.left
        anchors.right: panel.left
        anchors.top: chromeStrip.bottom
        anchors.bottom: parent.bottom

        // Drives ChromeShader's hexrain motion. Multiplied by harness.speed
        // each frame.
        property real iTime: 0

        // Chrome-family uniforms. Keys match the std140 names in
        // chrome_hexrain.frag — applyState() writes by name lookup. To support
        // a shader with different uniforms, declare them here as additional
        // properties.
        property real intensity: 1.0
        property real cellSize: 14
        property real modeAmount: 1.0
        property real domeStrength: 0.8
        property real seamGlow: 1.5
        property real sunDriftSpeed: 1.0
        property real heightAmount: 1.0
        property real matteness: 0.70
        property real bleedBack: 0.03
        property real hexBevel: 0.6
        property real heightDriftSpeed: 0.6
        property real frontSunStrength: 1.5
        property real frontSunSpeed: 1.0
        property real frontSunSize: 0.3
        property real frontSunShadowLength: 1.8
        property real frontSunShadowDarkness: 0.95
        property real backSunSize: 0.4
        property real backSunStrength: 1.0
        property real backNegSunSize: 0.3
        property real backNegSunStrength: 0.7
        property real backNegSunSpeed: 1.0
        property real backSunPaletteSpeed: 0.5
        property real frontSunPaletteSpeed: 0.5
        property real backSunCount: 3
        property real backNegSunCount: 1
        property real frontSunCount: 1
        property real frontNegSunCount: 0
        property real frontNegSunStrength: 0.7
        property real frontNegSunSize: 0.3
        property real frontNegSunSpeed: 1.0
        property real flipOriginX: 0.0
        property real flipOriginY: 0.0
        // Sentinel = far-future iTime. Per-hex flip phase math gives
        // a negative numerator → clamped to 0 → renders the Current
        // palette. triggerFlip() sets this to the actual current
        // iTime to kick off the wave; flipCommitTimer resets back to
        // sentinel after the wave finishes.
        property real flipStartTime: 1.0e9
        property real flipPropDelay: 0.05
        property real flipDuration: 0.5
        property real depthShading: 0.35
        property real flipSpecular: 0.8
        property real hexDepth: 0.7
        property vector3d iResolution: Qt.vector3d(width, height, 1)
        property vector4d colorPrimary:           Qt.vector4d(0.345, 0.588, 0.882, 1.0)
        property vector4d colorSecondary:         Qt.vector4d(0.718, 0.067, 0.859, 1.0)
        property vector4d colorPrimaryContainer:  Qt.vector4d(0.090, 0.043, 0.333, 1.0)
        property vector4d colorTertiary:          Qt.vector4d(0.224, 1.000, 0.600, 1.0)
        property vector4d colorPrimaryNext:           colorPrimary
        property vector4d colorSecondaryNext:         colorSecondary
        property vector4d colorPrimaryContainerNext:  colorPrimaryContainer
        property vector4d colorTertiaryNext:          colorTertiary

        fragmentShader: "file://" + root.qsbPath + "?v=" + root.qsbRev
    }

    FrameAnimation {
        running: true
        onTriggered: shaderEffect.iTime += frameTime * (root.harnessState.speed !== undefined ? root.harnessState.speed : 1.0)
    }

    // ===== Control panel (right) =====

    Rectangle {
        id: panel
        anchors.right: parent.right
        anchors.top: chromeStrip.bottom
        anchors.bottom: parent.bottom
        width: 320
        color: "#101010"
        border.color: "#262626"
        border.width: 1

        ScrollView {
            anchors.fill: parent
            anchors.margins: 12
            clip: true

            ColumnLayout {
                width: panel.width - 24
                spacing: 6

                Repeater {
                    model: root.sections

                    delegate: ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 4
                        readonly property var sec: modelData
                        readonly property bool open: root.expanded[sec.name] !== false

                        // Section header — click to toggle expand/collapse.
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 24
                            color: headerArea.containsMouse ? "#262626" : "#1a1a1a"
                            border.color: "#303030"
                            border.width: 1
                            radius: 3

                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: 8
                                anchors.rightMargin: 8

                                Text {
                                    color: "#cfcfcf"
                                    font.family: "monospace"
                                    font.pixelSize: 11
                                    font.bold: true
                                    text: (open ? "▼ " : "▶ ") + sec.name
                                }
                                Item { Layout.fillWidth: true }
                                Text {
                                    color: "#606060"
                                    font.family: "monospace"
                                    font.pixelSize: 10
                                    text: sec.controls.length + ""
                                }
                            }

                            MouseArea {
                                id: headerArea
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.toggleSection(sec.name)
                            }
                        }

                        // Section body — visible only when open.
                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.leftMargin: 6
                            spacing: 4
                            visible: open

                            Repeater {
                                model: sec.controls

                                delegate: Loader {
                                    Layout.fillWidth: true
                                    property var d: modelData
                                    sourceComponent: d.kind === "real" ? sliderRowComp : colorRowComp
                                }
                            }
                        }
                    }
                }

                Item { Layout.fillHeight: true; Layout.minimumHeight: 12 }

                Button {
                    Layout.fillWidth: true
                    text: root.flipActive ? "flipping…" : "Trigger flip"
                    enabled: !root.flipActive
                    onClicked: root.triggerFlip()
                }

                Button {
                    Layout.fillWidth: true
                    text: root.dirty ? "Save uniforms.json  •" : "Save uniforms.json"
                    enabled: root.dirty
                    onClicked: root.persist()
                }
            }
        }
    }

    // ===== Component delegates =====

    Component {
        id: sliderRowComp

        ColumnLayout {
            // parent is the Loader, which carries `d` (the modelData snapshot).
            readonly property var d: parent.d
            spacing: 1

            RowLayout {
                Layout.fillWidth: true
                Text {
                    Layout.fillWidth: true
                    color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 12
                    text: d.key
                }
                Text {
                    color: "#9090b0"; font.family: "monospace"; font.pixelSize: 11
                    // 2 decimals for fractional steps, 0 for integer steps.
                    text: slider.value.toFixed(d.step < 1 ? 2 : 0)
                }
            }

            Slider {
                id: slider
                Layout.fillWidth: true
                from: d.minVal
                to: d.maxVal
                stepSize: d.step
                value: d.value
                onMoved: root.setValue(d.section, d.key, value)
            }
        }
    }

    Component {
        id: colorRowComp

        RowLayout {
            readonly property var d: parent.d
            spacing: 6

            // Track external changes (e.g. JSON edited in editor) → text field.
            // Hex parsing is on text edit; bad input shows red border.
            property string committed: d.value

            Rectangle {
                Layout.preferredWidth: 28
                Layout.preferredHeight: 22
                radius: 3
                color: input.acceptableInput ? input.text : "#202020"
                border.color: input.acceptableInput ? "#505050" : "#cc4040"
                border.width: 1
            }

            Text {
                Layout.preferredWidth: 110
                color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 12
                text: d.key
                elide: Text.ElideRight
            }

            TextField {
                id: input
                Layout.fillWidth: true
                font.family: "monospace"; font.pixelSize: 12
                text: d.value
                selectByMouse: true
                // QtQuick.Controls TextField has acceptableInput driven by validator.
                validator: RegularExpressionValidator {
                    regularExpression: /^#[0-9a-fA-F]{6}$/
                }
                onEditingFinished: {
                    if (acceptableInput) {
                        root.setValue(d.section, d.key, text);
                    }
                }
            }
        }
    }

    // ===== Esc-to-quit =====

    Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.onEscapePressed: Qt.quit()
    }
}
