import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Services

// In-DMS scene editor. Reads/writes SceneStateService.scenes.wallpaper
// — slider drags here mutate the singleton, and ShaderWallpaperBackground
// rebinds its uniforms instantly. Save writes the singleton state back
// to disk so subsequent DMS launches reload it.

FloatingWindow {
    id: editor

    title: "Scene Editor — wallpaper"
    minimumSize: Qt.size(380, 600)
    color: "#0a0a0a"
    implicitWidth: 380
    implicitHeight: 720

    readonly property string sceneName: "wallpaper"
    readonly property var sceneEntry: SceneStateService.scenes[sceneName] || ({ data: {}, harness: {} })
    readonly property var sceneData:    sceneEntry.data    || ({})
    readonly property var sceneHarness: sceneEntry.harness || ({})
    readonly property bool dirty: SceneStateService.isDirty(sceneName)

    // Per-knob hint table for slider bounds.
    readonly property var hints: ({
        "intensity":      { min: 0.0, max: 1.0, step: 0.01 },
        "cellSize":       { min: 4,   max: 80,  step: 1    },
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
        "frontSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "frontSunLifetime": { min: 5.0, max: 180.0, step: 1.0 },
        "frontSunGap":      { min: 0.0, max: 120.0, step: 0.5 },
        "frontSunSpeed":    { min: 0.0, max: 0.5, step: 0.002 },
        "frontSunShadowLength":   { min: 0.0, max: 4.0, step: 0.05 },
        "frontSunShadowDarkness": { min: 0.0, max: 3.0, step: 0.02 },
        "backSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "backSunStrength": { min: 0.0, max: 3.0, step: 0.02 },
        "backSunLifetime": { min: 5.0, max: 180.0, step: 1.0 },
        "backSunGap":      { min: 0.0, max: 120.0, step: 0.5 },
        "backSunSpeed":    { min: 0.0, max: 0.5, step: 0.002 },
        "backNegSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "backNegSunStrength": { min: 0.0, max: 1.0, step: 0.01 },
        "backNegSunLifetime": { min: 5.0, max: 180.0, step: 1.0 },
        "backNegSunGap":      { min: 0.0, max: 120.0, step: 0.5 },
        "backNegSunSpeed":    { min: 0.0, max: 0.5, step: 0.002 },
        "backSunPaletteSpeed":  { min: 0.0, max: 3.0, step: 0.02 },
        "frontSunPaletteSpeed": { min: 0.0, max: 3.0, step: 0.02 },
        "backSunCount":      { min: 0, max: 10, step: 1 },
        "backNegSunCount":   { min: 0, max: 10, step: 1 },
        "frontSunCount":     { min: 0, max: 10, step: 1 },
        "frontNegSunCount":  { min: 0, max: 10, step: 1 },
        "frontNegSunStrength": { min: 0.0, max: 1.0, step: 0.01 },
        "frontNegSunSize":     { min: 0.05, max: 1.0, step: 0.01 },
        "frontNegSunLifetime": { min: 5.0, max: 180.0, step: 1.0 },
        "frontNegSunGap":      { min: 0.0, max: 120.0, step: 0.5 },
        "frontNegSunSpeed":    { min: 0.0, max: 0.5, step: 0.002 },
        "fastBackSunStrength": { min: 0.0, max: 3.0, step: 0.02 },
        "fastBackSunSize":     { min: 0.02, max: 0.6, step: 0.005 },
        "fastBackSunLifetime": { min: 1.0, max: 60.0, step: 0.5 },
        "fastBackSunGap":      { min: 0.0, max: 120.0, step: 0.5 },
        "fastBackSunSpeed":    { min: 0.0, max: 1.0, step: 0.005 },
        "barZoneEnabled":   { min: 0, max: 1, step: 1 },
        "barZoneAnchor":    { min: 0, max: 1, step: 1 },
        "barZoneThickness": { min: 0, max: 300, step: 1 },
        "barZoneElevation": { min: 0.0, max: 2.0, step: 0.02 },
        "flipPropDelay":  { min: 0.0, max: 0.5, step: 0.005 },
        "flipDuration":   { min: 0.05, max: 3.0, step: 0.05 },
        "depthShading":   { min: 0.0, max: 1.0, step: 0.01 },
        "flipSpecular":   { min: 0.0, max: 3.0, step: 0.02 },
        "hexDepth":       { min: 0.0, max: 1.5, step: 0.02 }
    })

    // Section grouping. Each entry's keys reference either shader uniforms
    // (live in sceneData) or harness values (sceneHarness).
    readonly property var sectionMap: ([
        { name: "field", keys: [
            "intensity", "cellSize", "modeAmount", "domeStrength", "seamGlow",
            "sunDriftSpeed", "heightAmount", "matteness", "bleedBack",
            "hexBevel", "heightDriftSpeed", "depthShading", "hexDepth"
        ] },
        { name: "front sun", keys: [
            "frontSunCount", "frontSunStrength", "frontSunSize",
            "frontSunLifetime", "frontSunGap", "frontSunSpeed",
            "frontSunShadowLength", "frontSunShadowDarkness", "frontSunPaletteSpeed"
        ] },
        { name: "negative front sun", keys: [
            "frontNegSunCount", "frontNegSunStrength", "frontNegSunSize",
            "frontNegSunLifetime", "frontNegSunGap", "frontNegSunSpeed"
        ] },
        { name: "back sun", keys: [
            "backSunCount", "backSunStrength", "backSunSize",
            "backSunLifetime", "backSunGap", "backSunSpeed",
            "backSunPaletteSpeed"
        ] },
        { name: "negative back sun", keys: [
            "backNegSunCount", "backNegSunStrength", "backNegSunSize",
            "backNegSunLifetime", "backNegSunGap", "backNegSunSpeed"
        ] },
        { name: "fast back sun", keys: [
            "fastBackSunStrength", "fastBackSunSize",
            "fastBackSunLifetime", "fastBackSunGap", "fastBackSunSpeed"
        ] },
        { name: "bar zone", keys: [
            "barZoneEnabled", "barZoneAnchor", "barZoneThickness", "barZoneElevation"
        ] },
        { name: "colors", keys: [
            "colorPrimary", "colorSecondary", "colorPrimaryContainer", "colorTertiary"
        ] },
        { name: "flip", keys: [
            "flipPropDelay", "flipDuration", "flipSpecular"
        ] },
        { name: "harness", keys: ["speed"] }
    ])

    // Per-section expand/collapse state.
    property var expanded: ({})

    function toggleSection(name) {
        const cur = (expanded[name] !== false);
        const next = Object.assign({}, expanded);
        next[name] = !cur;
        expanded = next;
    }

    function valueOf(key) {
        if (key === "speed") {
            return sceneHarness.speed !== undefined ? sceneHarness.speed : 1.0;
        }
        return sceneData[key];
    }

    function setKey(key, value) {
        const section = (key === "speed") ? "harness" : "shader";
        SceneStateService.setValue(sceneName, key, value, section);
    }

    function hintFor(key) {
        const h = hints[key];
        if (h) return h;
        return { min: 0, max: 2, step: 0.01 };
    }

    function isColorKey(key) {
        return key.startsWith("color") && !key.endsWith("Next");
    }

    Rectangle {
        anchors.fill: parent
        color: "#0a0a0a"

        ScrollView {
            anchors.fill: parent
            anchors.margins: 10
            clip: true

            ColumnLayout {
                width: editor.width - 32
                spacing: 6

                Repeater {
                    model: editor.sectionMap

                    delegate: ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 4
                        required property var modelData
                        readonly property var sec: modelData
                        readonly property bool open: editor.expanded[sec.name] !== false

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 26
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
                                    text: sec.keys.length + ""
                                }
                            }
                            MouseArea {
                                id: headerArea
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: editor.toggleSection(sec.name)
                            }
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.leftMargin: 6
                            spacing: 4
                            visible: open

                            Repeater {
                                model: sec.keys

                                delegate: Loader {
                                    Layout.fillWidth: true
                                    required property var modelData
                                    readonly property string keyName: modelData
                                    sourceComponent: editor.isColorKey(keyName) ? colorRowComp : sliderRowComp
                                }
                            }
                        }
                    }
                }

                Item { Layout.fillHeight: true; Layout.minimumHeight: 12 }

                Button {
                    Layout.fillWidth: true
                    text: editor.dirty ? "Save  •" : "Save"
                    enabled: editor.dirty
                    onClicked: SceneStateService.save(editor.sceneName)
                }
            }
        }
    }

    // ── Slider row ──
    Component {
        id: sliderRowComp
        ColumnLayout {
            readonly property string keyName: parent.keyName
            readonly property var hint: editor.hintFor(keyName)
            spacing: 1

            RowLayout {
                Layout.fillWidth: true
                Text {
                    Layout.fillWidth: true
                    color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 12
                    text: keyName
                }
                Text {
                    color: "#9090b0"; font.family: "monospace"; font.pixelSize: 11
                    text: {
                        const v = editor.valueOf(keyName);
                        if (typeof v !== "number") return "—";
                        return v.toFixed(hint.step < 1 ? 2 : 0);
                    }
                }
            }
            Slider {
                Layout.fillWidth: true
                from: hint.min
                to:   hint.max
                stepSize: hint.step
                value: {
                    const v = editor.valueOf(keyName);
                    return typeof v === "number" ? v : hint.min;
                }
                onMoved: editor.setKey(keyName, value)
            }
        }
    }

    // ── Colour row (click swatch → open picker popup) ──
    Component {
        id: colorRowComp
        RowLayout {
            readonly property string keyName: parent.keyName
            readonly property string liveValue: {
                const v = editor.sceneData[keyName];
                return (v && typeof v === "string") ? v : "#000000";
            }
            readonly property bool liveValid: /^#[0-9a-fA-F]{6}$/.test(liveValue)
            spacing: 6

            Rectangle {
                Layout.preferredWidth: 28
                Layout.preferredHeight: 22
                radius: 3
                color: liveValid ? liveValue : "#202020"
                border.color: swatchMA.containsMouse
                            ? "#a0a0a0"
                            : (liveValid ? "#505050" : "#cc4040")
                border.width: 1
                MouseArea {
                    id: swatchMA
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: editorColorPicker.openFor(keyName, liveValue)
                }
            }
            Text {
                Layout.preferredWidth: 110
                color: "#cfcfcf"; font.family: "monospace"; font.pixelSize: 12
                text: keyName
                elide: Text.ElideRight
            }
            TextField {
                Layout.fillWidth: true
                font.family: "monospace"; font.pixelSize: 12
                text: liveValue
                selectByMouse: true
                validator: RegularExpressionValidator {
                    regularExpression: /^#[0-9a-fA-F]{6}$/
                }
                onEditingFinished: {
                    if (acceptableInput) editor.setKey(keyName, text);
                }
            }
        }
    }

    // ── Colour picker popup ──
    function _hexFromRgb(r, g, b) {
        const to = function (x) {
            let v = Math.round(Math.max(0, Math.min(1, x)) * 255);
            const s = v.toString(16);
            return s.length === 1 ? "0" + s : s;
        };
        return "#" + to(r) + to(g) + to(b);
    }
    function _hsvToRgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        let r=0, g=0, b=0;
        if      (h < 60)  { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else              { r = c; g = 0; b = x; }
        return { r: r + m, g: g + m, b: b + m };
    }
    function _rgbToHsv(r, g, b) {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const d  = mx - mn;
        let h = 0;
        if (d > 0.0001) {
            if      (mx === r) h = (((g - b) / d) % 6);
            else if (mx === g) h = ((b - r) / d) + 2;
            else               h = ((r - g) / d) + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        const s = mx === 0 ? 0 : d / mx;
        return { h: h, s: s, v: mx };
    }

    Popup {
        id: editorColorPicker
        anchors.centerIn: Overlay.overlay
        width: 380
        height: 320
        modal: true
        focus: true

        property string editingKey: ""
        property real h: 0
        property real s: 0
        property real v: 1

        function openFor(key, hexValue) {
            editingKey = key;
            const c = Qt.color(hexValue);
            const hsv = editor._rgbToHsv(c.r, c.g, c.b);
            h = hsv.h; s = hsv.s; v = hsv.v;
            open();
        }
        function pushColor() {
            const rgb = editor._hsvToRgb(h, s, v);
            editor.setKey(editingKey, editor._hexFromRgb(rgb.r, rgb.g, rgb.b));
        }
        onHChanged: pushColor()
        onSChanged: pushColor()
        onVChanged: pushColor()

        background: Rectangle {
            color: "#1a1a1a"
            border.color: "#505050"
            border.width: 1
            radius: 4
        }

        contentItem: ColumnLayout {
            spacing: 8
            Text {
                Layout.fillWidth: true
                color: "#cfcfcf"
                font.family: "monospace"; font.pixelSize: 12; font.bold: true
                text: "edit: " + editorColorPicker.editingKey
            }
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 10

                Item {
                    id: svBox
                    Layout.preferredWidth: 220
                    Layout.fillHeight: true
                    Rectangle {
                        anchors.fill: parent
                        gradient: Gradient {
                            orientation: Gradient.Horizontal
                            GradientStop { position: 0.0; color: "white" }
                            GradientStop {
                                position: 1.0
                                color: {
                                    const rgb = editor._hsvToRgb(editorColorPicker.h, 1.0, 1.0);
                                    return editor._hexFromRgb(rgb.r, rgb.g, rgb.b);
                                }
                            }
                        }
                    }
                    Rectangle {
                        anchors.fill: parent
                        gradient: Gradient {
                            GradientStop { position: 0.0; color: "transparent" }
                            GradientStop { position: 1.0; color: "black" }
                        }
                    }
                    Rectangle {
                        width: 10; height: 10; radius: 5
                        color: "transparent"
                        border.color: "#ffffff"; border.width: 2
                        x: editorColorPicker.s * (svBox.width - width)
                        y: (1.0 - editorColorPicker.v) * (svBox.height - height)
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.CrossCursor
                        function update(mx, my) {
                            editorColorPicker.s = Math.max(0, Math.min(1, mx / svBox.width));
                            editorColorPicker.v = Math.max(0, Math.min(1, 1.0 - my / svBox.height));
                        }
                        onPressed:         function (e) { update(e.x, e.y); }
                        onPositionChanged: function (e) { update(e.x, e.y); }
                    }
                }

                Item {
                    id: hueBox
                    Layout.preferredWidth: 28
                    Layout.fillHeight: true
                    Rectangle {
                        anchors.fill: parent
                        radius: 3
                        gradient: Gradient {
                            GradientStop { position: 0.0;       color: "#ff0000" }
                            GradientStop { position: 0.1666667; color: "#ffff00" }
                            GradientStop { position: 0.3333333; color: "#00ff00" }
                            GradientStop { position: 0.5;       color: "#00ffff" }
                            GradientStop { position: 0.6666667; color: "#0000ff" }
                            GradientStop { position: 0.8333333; color: "#ff00ff" }
                            GradientStop { position: 1.0;       color: "#ff0000" }
                        }
                    }
                    Rectangle {
                        width: parent.width + 4; height: 3
                        x: -2
                        y: (editorColorPicker.h / 360.0) * (hueBox.height - height)
                        color: "#ffffff"
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.SizeVerCursor
                        function update(my) {
                            editorColorPicker.h = Math.max(0, Math.min(360, (my / hueBox.height) * 360));
                        }
                        onPressed:         function (e) { update(e.y); }
                        onPositionChanged: function (e) { update(e.y); }
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: 6
                Rectangle {
                    Layout.preferredWidth: 36
                    Layout.preferredHeight: 22
                    radius: 3
                    color: {
                        const rgb = editor._hsvToRgb(editorColorPicker.h, editorColorPicker.s, editorColorPicker.v);
                        return editor._hexFromRgb(rgb.r, rgb.g, rgb.b);
                    }
                    border.color: "#505050"; border.width: 1
                }
                TextField {
                    Layout.fillWidth: true
                    font.family: "monospace"; font.pixelSize: 12
                    text: {
                        const rgb = editor._hsvToRgb(editorColorPicker.h, editorColorPicker.s, editorColorPicker.v);
                        return editor._hexFromRgb(rgb.r, rgb.g, rgb.b);
                    }
                    selectByMouse: true
                    validator: RegularExpressionValidator {
                        regularExpression: /^#[0-9a-fA-F]{6}$/
                    }
                    onEditingFinished: {
                        if (acceptableInput) {
                            const c = Qt.color(text);
                            const hsv = editor._rgbToHsv(c.r, c.g, c.b);
                            editorColorPicker.h = hsv.h;
                            editorColorPicker.s = hsv.s;
                            editorColorPicker.v = hsv.v;
                        }
                    }
                }
                Button {
                    text: "Done"
                    onClicked: editorColorPicker.close()
                }
            }
        }
    }
}
