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
        "subModeAmount":  { min: 0.0, max: 1.0, step: 0.01 },
        "domeStrength":   { min: 0.0, max: 1.0, step: 0.01 },
        "seamGlow":       { min: 0.0, max: 3.0, step: 0.02 },
        "sunDriftSpeed":  { min: 0.0, max: 3.0, step: 0.05 },
        "heightAmount":   { min: 0.0, max: 1.0, step: 0.01 },
        "matteness":      { min: 0.0, max: 1.0, step: 0.01 },
        "bleedBack":      { min: 0.0, max: 0.3, step: 0.005 },
        "hexBevel":       { min: 0.0, max: 1.0, step: 0.01 }
    })

    // Flat array used as Repeater model. Built from shaderState + harnessState.
    property var controls: []

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

    function rebuildControls() {
        const list = [];
        for (const k in shaderState) {
            if (k.startsWith("_")) continue;
            const v = shaderState[k];
            const h = hints[k];
            if (typeof v === "number") {
                list.push({
                    section: "shader",
                    key: k,
                    kind: "real",
                    value: v,
                    minVal: h ? h.min : 0,
                    maxVal: h ? h.max : 2,
                    step:   h ? h.step : 0.01
                });
            } else if (typeof v === "string" && v.startsWith("#")) {
                list.push({
                    section: "shader",
                    key: k,
                    kind: "color",
                    value: v
                });
            }
        }
        for (const k in harnessState) {
            if (k.startsWith("_")) continue;
            const v = harnessState[k];
            const h = hints[k];
            list.push({
                section: "harness",
                key: k,
                kind: "real",
                value: v,
                minVal: h ? h.min : 0,
                maxVal: h ? h.max : 3,
                step:   h ? h.step : 0.05
            });
        }
        controls = list;
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
                root.rebuildControls();
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
        property real subModeAmount: 1.0
        property real domeStrength: 0.8
        property real seamGlow: 1.5
        property real sunDriftSpeed: 1.0
        property real heightAmount: 1.0
        property real matteness: 0.70
        property real bleedBack: 0.03
        property real hexBevel: 0.6
        property vector3d iResolution: Qt.vector3d(width, height, 1)
        property vector4d colorPrimary:           Qt.vector4d(0.345, 0.588, 0.882, 1.0)
        property vector4d colorSecondary:         Qt.vector4d(0.718, 0.067, 0.859, 1.0)
        property vector4d colorPrimaryContainer:  Qt.vector4d(0.090, 0.043, 0.333, 1.0)
        property vector4d colorTertiary:          Qt.vector4d(0.224, 1.000, 0.600, 1.0)

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
                spacing: 8

                Text {
                    color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 11; font.bold: true
                    text: "shader"
                }

                Repeater {
                    model: root.controls.filter(function (c) { return c.section === "shader"; })

                    delegate: Loader {
                        Layout.fillWidth: true
                        property var d: modelData
                        sourceComponent: d.kind === "real" ? sliderRowComp : colorRowComp
                    }
                }

                Item { Layout.preferredHeight: 8 }

                Text {
                    color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 11; font.bold: true
                    text: "harness"
                }

                Repeater {
                    model: root.controls.filter(function (c) { return c.section === "harness"; })

                    delegate: Loader {
                        Layout.fillWidth: true
                        property var d: modelData
                        sourceComponent: sliderRowComp
                    }
                }

                Item { Layout.fillHeight: true; Layout.minimumHeight: 12 }

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
