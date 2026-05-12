import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Qt.labs.folderlistmodel
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
    // Default paths point at the production scenes/ directory in the
    // DMS repo so dev edits ARE the production scene state — saving
    // here updates what the live wallpaper / bar / popouts render.
    property string activePath: harnessDir + "../../quickshell/Shaders/scenes/wallpaper.json"
    property string targetPath: harnessDir + "../../quickshell/Shaders/scenes/wallpaper-alt.json"
    readonly property string qsbPath: harnessDir + "../../quickshell/Shaders/qsb/chrome_hexrain.frag.qsb"

    // ===== Live state =====

    // Editable state — drives panel sliders + GPU uniforms. Save
    // writes this to activePath; Flip tweens it toward targetSceneData.
    property var shaderState: ({})
    property var harnessState: ({})
    // Last-parsed contents of each on-disk scene file. activeSceneData
    // is the disk's view of what shaderState should be (Save updates
    // this to match shaderState). targetSceneData is the destination
    // for the next flip.
    property var activeSceneData: ({})
    property var targetSceneData: ({})

    // Filename helper (just the basename, no directory).
    function basename(p) {
        if (!p) return "";
        const i = p.lastIndexOf("/");
        return (i >= 0) ? p.substring(i + 1) : p;
    }

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
        "fastBackSunStrength":     { min: 0.0, max: 3.0, step: 0.02 },
        "fastBackSunSize":         { min: 0.02, max: 0.6, step: 0.005 },
        "fastBackSunFrequency":    { min: 0.0, max: 2.0, step: 0.02 },
        "fastBackSunSpeed":        { min: 0.0, max: 8.0, step: 0.05 },
        "fastBackSunPaletteSpeed": { min: 0.0, max: 3.0, step: 0.02 },
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
        { name: "fast back sun", keys: [
            "fastBackSunStrength", "fastBackSunSize", "fastBackSunFrequency",
            "fastBackSunSpeed", "fastBackSunPaletteSpeed"
        ] },
        { name: "colors", keys: [
            "colorPrimary", "colorSecondary", "colorPrimaryContainer", "colorTertiary"
        ] },
        { name: "flip", keys: [
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
    // *Next colour keys are derived from the secondary preset, not
    // user-edited, so they're hidden too.
    readonly property var hiddenKeys: ({
        "flipStartTime": true,
        "flipOriginX": true,
        "flipOriginY": true,
        "colorPrimaryNext":           true,
        "colorSecondaryNext":         true,
        "colorPrimaryContainerNext":  true,
        "colorTertiaryNext":          true
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

    // Preset flip — kicks off the colour wave AND a per-frame
    // parameter tween that interpolates every numeric uniform from
    // the active preset to the target preset over the wave duration.
    // After the wave commits, the target preset becomes active and
    // future flips target what was the active preset (true A↔B).
    property bool flipActive: false
    // Keys NOT tweened: the wave's own controls, flip state, and the
    // colour pairs (which the shader handles via per-cell flip phase).
    readonly property var noTweenKeys: ({
        "flipStartTime":  true,
        "flipOriginX":    true,
        "flipOriginY":    true,
        "flipPropDelay":  true,
        "flipDuration":   true,
        "colorPrimary":           true,
        "colorSecondary":         true,
        "colorPrimaryContainer":  true,
        "colorTertiary":          true,
        "colorPrimaryNext":           true,
        "colorSecondaryNext":         true,
        "colorPrimaryContainerNext":  true,
        "colorTertiaryNext":          true
    })
    // Snapshot of the active preset at the moment flip was triggered.
    // Used as the "from" side of the parameter tween.
    property var flipFromSnapshot: ({})
    property var flipTargetPreset: ({})
    // Wave duration in iTime-seconds — drives the tween clock.
    property real flipTweenDuration: 1.0
    property real flipTweenStartITime: 0.0

    function triggerFlip() {
        if (flipActive) return;
        const target = targetSceneData;
        if (Object.keys(target).length === 0) {
            console.warn("Trigger flip: target scene is empty — Browse to a scene file first.");
            return;
        }

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
        const maxDist = Math.sqrt(
            Math.max(ox, w - ox) * Math.max(ox, w - ox) +
            Math.max(oy, h - oy) * Math.max(oy, h - oy));
        const pitch = Math.max(cellSize * 1.7320508, 1.0);
        const totalSec = (maxDist / pitch) * propDelay + duration;
        const speed = root.harnessState.speed !== undefined ? root.harnessState.speed : 1.0;
        const wallClockMs = totalSec * 1000.0 / Math.max(speed, 0.01) + 200.0;

        // Snapshot the active preset so the tween has a stable "from" side
        // even if external file changes come in mid-flip.
        flipFromSnapshot = JSON.parse(JSON.stringify(shaderState));
        flipTargetPreset = target;
        flipTweenDuration = totalSec;
        flipTweenStartITime = shaderEffect.iTime;

        // Wire the shader's per-cell colour wave: Next colours come from
        // the target preset; the shader's cellFlipPhase interpolates
        // between current and Next as the wave passes each cell.
        const colorKeys = [
            "colorPrimary", "colorSecondary",
            "colorPrimaryContainer", "colorTertiary"
        ];
        for (let i = 0; i < colorKeys.length; i++) {
            const k = colorKeys[i];
            if (target[k] !== undefined) {
                shaderState[k + "Next"] = target[k];
            }
        }

        shaderState["flipOriginX"] = ox;
        shaderState["flipOriginY"] = oy;
        shaderState["flipStartTime"] = shaderEffect.iTime;
        shaderState = shaderState;
        applyState();
        flipActive = true;
        flipTweenTimer.start();
        flipCommitTimer.interval = Math.max(50, wallClockMs);
        flipCommitTimer.start();
    }

    // Per-frame numeric tween. Lerps every non-color numeric key from
    // the active-preset snapshot to the target preset over the wave's
    // iTime duration. Counts get rounded; cellSize gets tweened (which
    // re-tiles the field smoothly — slightly disorienting at large
    // deltas but acceptable for transitions).
    Timer {
        id: flipTweenTimer
        interval: 16
        repeat: true
        running: false
        onTriggered: {
            const elapsed = shaderEffect.iTime - root.flipTweenStartITime;
            let t = elapsed / Math.max(root.flipTweenDuration, 0.001);
            if (t < 0.0) t = 0.0;
            if (t > 1.0) t = 1.0;
            // Smoothstep for a gentler ease at both ends.
            const tt = t * t * (3.0 - 2.0 * t);

            const integerKeys = {
                "backSunCount": true, "backNegSunCount": true,
                "frontSunCount": true, "frontNegSunCount": true
            };
            for (const k in root.flipFromSnapshot) {
                if (root.noTweenKeys[k]) continue;
                if (!(k in root.flipTargetPreset)) continue;
                const from = root.flipFromSnapshot[k];
                const to   = root.flipTargetPreset[k];
                if (typeof from !== "number" || typeof to !== "number") continue;
                let v = from + (to - from) * tt;
                if (integerKeys[k]) v = Math.round(v);
                root.shaderState[k] = v;
            }
            root.shaderState = root.shaderState;
            root.applyState();
            if (t >= 1.0) flipTweenTimer.stop();
        }
    }

    Timer {
        id: flipCommitTimer
        repeat: false
        onTriggered: {
            // Stop the tween (may have already finished naturally) and
            // apply the target preset's values WHOLESALE so we end up
            // exactly at the destination — no rounding drift.
            flipTweenTimer.stop();
            for (const k in root.flipTargetPreset) {
                if (root.noTweenKeys[k]) continue;
                root.shaderState[k] = root.flipTargetPreset[k];
            }
            // Apply target colours as the new "current". The shader's
            // *Next slots already hold the target colours from the
            // trigger; we copy them into "current" so the post-commit
            // render (with flipStartTime reset → phase=0 → renders
            // current) shows the target palette exactly.
            const colorKeys = [
                "colorPrimary", "colorSecondary",
                "colorPrimaryContainer", "colorTertiary"
            ];
            for (let i = 0; i < colorKeys.length; i++) {
                const k = colorKeys[i];
                if (root.flipTargetPreset[k] !== undefined) {
                    root.shaderState[k] = root.flipTargetPreset[k];
                }
            }
            // Swap active and target scenes: what was active becomes
            // the new target (so flipping again returns to it), and
            // what was target becomes the new active. Both the file
            // paths and the in-memory snapshots swap.
            const oldActiveData = JSON.parse(JSON.stringify(root.activeSceneData));
            const oldActivePath = root.activePath;
            root.activeSceneData = JSON.parse(JSON.stringify(root.targetSceneData));
            root.targetSceneData = oldActiveData;
            root.activePath = root.targetPath;
            root.targetPath = oldActivePath;

            // Refresh *Next colours so the next flip has a real delta
            // (Next = what we'd flip to = the new target).
            for (let i = 0; i < colorKeys.length; i++) {
                const k = colorKeys[i];
                if (root.targetSceneData[k] !== undefined) {
                    root.shaderState[k + "Next"] = root.targetSceneData[k];
                }
            }
            // Reset wave state to idle.
            root.shaderState["flipStartTime"] = 1.0e9;
            root.shaderState = root.shaderState;
            root.applyState();
            root.rebuildSections();
            root.flipActive = false;
            root.dirty = false;
        }
    }

    function setValue(section, key, value) {
        const target = (section === "shader") ? shaderState : harnessState;
        target[key] = value;
        // QML var properties don't fire change notifications on
        // self-assignment when the reference is unchanged — bindings
        // on shaderState[key] would not re-evaluate. Creating a new
        // shallow copy gives a fresh reference and triggers every
        // dependent binding (which is what makes the live colour
        // swatch + hex field in the panel update during picker drags).
        if (section === "shader") shaderState = Object.assign({}, target);
        else                      harnessState = Object.assign({}, target);
        applyState();
        dirty = true;
        // Auto-save with debounce so any DMS surface watching this
        // scene file picks up the change ~100ms after the user stops
        // moving the slider. Without debounce we'd thrash the disk
        // during a drag.
        autoSaveTimer.restart();
    }

    Timer {
        id: autoSaveTimer
        interval: 100
        repeat: false
        onTriggered: if (root.dirty) root.persist()
    }

    function persist() {
        const obj = {
            "_comment": "Live-reloaded by ShaderPreview.qml. Edit + save here, or use the in-window panel and click Save.",
            "_schema": "Keys under .shader MUST match std140 uniform names in the .frag exactly. Keys under .harness drive QML behaviour (not GPU uniforms).",
            "shader": shaderState,
            "harness": harnessState
        };
        const text = JSON.stringify(obj, null, 2) + "\n";
        activeView.ourWrite = true;
        activeView.setText(text);
        activeSceneData = JSON.parse(JSON.stringify(shaderState));
        dirty = false;
    }

    // Save the current state to a new file path. Used by Save As.
    function persistAs(newPath) {
        // Repointing activeView's path causes it to reload from the new
        // file IF that file already exists. To avoid that, write first
        // (which creates/overwrites), then update activePath.
        const obj = {
            "_comment": "Live-reloaded by ShaderPreview.qml. Edit + save here, or use the in-window panel and click Save.",
            "_schema": "Keys under .shader MUST match std140 uniform names in the .frag exactly. Keys under .harness drive QML behaviour (not GPU uniforms).",
            "shader": shaderState,
            "harness": harnessState
        };
        const text = JSON.stringify(obj, null, 2) + "\n";
        // Mark our-write before changing path so the resulting load is silent.
        activeView.ourWrite = true;
        root.activePath = newPath;
        activeView.setText(text);
        activeSceneData = JSON.parse(JSON.stringify(shaderState));
        dirty = false;
    }

    // ===== File watchers =====

    // ===== Colour picker =====
    //
    // Pure-QML HSV picker — native QtQuick.Dialogs.ColorDialog would
    // crash Quickshell the same way the file dialog does (portal
    // handshake). Saturation/Value box on the left, vertical hue
    // slider on the right, hex field at the bottom. Updates are
    // live: drag → shaderState[key] updates immediately.

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
        id: colorPicker
        anchors.centerIn: Overlay.overlay
        width: 380
        height: 320
        modal: true
        focus: true

        property string editingSection: "shader"
        property string editingKey: ""
        // Working HSV state. Bound to UI; pushing to shaderState happens
        // each time h/s/v changes so the field updates live.
        property real h: 0
        property real s: 0
        property real v: 1

        function openFor(sec, key, hexValue) {
            editingSection = sec;
            editingKey = key;
            const c = Qt.color(hexValue);
            const hsv = root._rgbToHsv(c.r, c.g, c.b);
            h = hsv.h; s = hsv.s; v = hsv.v;
            open();
        }

        function pushColor() {
            const rgb = root._hsvToRgb(h, s, v);
            const hex = root._hexFromRgb(rgb.r, rgb.g, rgb.b);
            root.setValue(editingSection, editingKey, hex);
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
                font.family: "monospace"
                font.pixelSize: 12
                font.bold: true
                text: "edit: " + colorPicker.editingKey
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 10

                // Saturation × Value box. Two stacked gradients give the
                // proper HSV space: horizontal white→hue, then vertical
                // transparent→black overlay. A small marker dot shows
                // the current (s,v) position. Click+drag updates s,v.
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
                                    const rgb = root._hsvToRgb(colorPicker.h, 1.0, 1.0);
                                    return root._hexFromRgb(rgb.r, rgb.g, rgb.b);
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

                    // Position marker
                    Rectangle {
                        width: 10; height: 10; radius: 5
                        color: "transparent"
                        border.color: "#ffffff"
                        border.width: 2
                        x: colorPicker.s * (svBox.width - width)
                        y: (1.0 - colorPicker.v) * (svBox.height - height)
                    }

                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.CrossCursor
                        function update(mx, my) {
                            colorPicker.s = Math.max(0, Math.min(1, mx / svBox.width));
                            colorPicker.v = Math.max(0, Math.min(1, 1.0 - my / svBox.height));
                        }
                        onPressed:         function (e) { update(e.x, e.y); }
                        onPositionChanged: function (e) { update(e.x, e.y); }
                    }
                }

                // Hue slider (vertical rainbow).
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
                    // Position marker
                    Rectangle {
                        width: parent.width + 4; height: 3
                        x: -2
                        y: (colorPicker.h / 360.0) * (hueBox.height - height)
                        color: "#ffffff"
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.SizeVerCursor
                        function update(my) {
                            colorPicker.h = Math.max(0, Math.min(360,
                                (my / hueBox.height) * 360));
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
                        const rgb = root._hsvToRgb(colorPicker.h, colorPicker.s, colorPicker.v);
                        return root._hexFromRgb(rgb.r, rgb.g, rgb.b);
                    }
                    border.color: "#505050"
                    border.width: 1
                }

                TextField {
                    id: hexInputInPicker
                    Layout.fillWidth: true
                    font.family: "monospace"; font.pixelSize: 12
                    text: {
                        const rgb = root._hsvToRgb(colorPicker.h, colorPicker.s, colorPicker.v);
                        return root._hexFromRgb(rgb.r, rgb.g, rgb.b);
                    }
                    selectByMouse: true
                    validator: RegularExpressionValidator {
                        regularExpression: /^#[0-9a-fA-F]{6}$/
                    }
                    onEditingFinished: {
                        if (acceptableInput) {
                            const c = Qt.color(text);
                            const hsv = root._rgbToHsv(c.r, c.g, c.b);
                            colorPicker.h = hsv.h;
                            colorPicker.s = hsv.s;
                            colorPicker.v = hsv.v;
                        }
                    }
                }

                Button {
                    text: "Done"
                    onClicked: colorPicker.close()
                }
            }
        }
    }

    // ===== Scene file browser =====
    //
    // Native FileDialog (QtQuick.Dialogs or Qt.labs.platform) crashes
    // inside Quickshell because there's no full QCoreApplication and
    // the xdg-desktop-portal handshake fails. So we build our own:
    // a FolderListModel scans for *.json scenes in harnessDir and a
    // single Popup shows them as a clickable list. The popup is
    // re-purposed for Open/Browse/Save-As via its `mode` and `onChoose`
    // callback.

    FolderListModel {
        id: scenesModel
        folder: "file://" + root.harnessDir
        nameFilters: ["*.json"]
        showDirs: false
        sortField: FolderListModel.Name
    }

    Popup {
        id: scenePicker
        anchors.centerIn: Overlay.overlay
        width: 480
        height: 360
        modal: true
        focus: true
        // mode = "openActive" | "openTarget" | "saveAs"
        property string mode: "openActive"

        background: Rectangle {
            color: "#1a1a1a"
            border.color: "#505050"
            border.width: 1
            radius: 4
        }

        function openFor(m) { mode = m; nameField.text = ""; open(); }

        function pick(path) {
            if (mode === "openActive") {
                root.activePath = path;
            } else if (mode === "openTarget") {
                root.targetPath = path;
            } else if (mode === "saveAs") {
                // Path already a full path here (clicked an existing file
                // would overwrite that file; using the text field is the
                // way to save under a new name).
                root.persistAs(path);
            }
            scenePicker.close();
        }

        contentItem: ColumnLayout {
            spacing: 8

            Text {
                Layout.fillWidth: true
                color: "#cfcfcf"
                font.family: "monospace"
                font.pixelSize: 12
                font.bold: true
                text: {
                    if (scenePicker.mode === "openActive") return "Open scene (active)";
                    if (scenePicker.mode === "openTarget") return "Choose flip target";
                    return "Save scene as…";
                }
            }

            Text {
                Layout.fillWidth: true
                color: "#808080"
                font.family: "monospace"
                font.pixelSize: 10
                text: root.harnessDir
                elide: Text.ElideMiddle
            }

            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true

                ListView {
                    id: filesList
                    model: scenesModel
                    spacing: 1

                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 26
                        color: rowMA.containsMouse ? "#303030" : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            color: "#cfcfcf"
                            font.family: "monospace"
                            font.pixelSize: 12
                            text: fileName
                        }
                        MouseArea {
                            id: rowMA
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                const fp = filePath.toString().replace(/^file:\/\//, "");
                                if (scenePicker.mode === "saveAs") {
                                    // Save As: clicking an existing file fills its
                                    // name into the text field rather than saving
                                    // immediately (avoids surprise overwrites).
                                    nameField.text = fileName;
                                } else {
                                    scenePicker.pick(fp);
                                }
                            }
                        }
                    }
                }
            }

            // Filename input — primary entry for Save As, also used as
            // a "type a path" fallback for Open.
            RowLayout {
                Layout.fillWidth: true
                spacing: 4

                TextField {
                    id: nameField
                    Layout.fillWidth: true
                    font.family: "monospace"
                    font.pixelSize: 12
                    placeholderText: scenePicker.mode === "saveAs"
                                   ? "new-scene-name.json"
                                   : "filename.json"
                }
                Button {
                    text: scenePicker.mode === "saveAs" ? "Save" : "Open"
                    enabled: nameField.text.length > 0
                    onClicked: {
                        const fp = root.harnessDir + nameField.text;
                        scenePicker.pick(fp);
                    }
                }
                Button {
                    text: "Cancel"
                    onClicked: scenePicker.close()
                }
            }
        }
    }

    FileView {
        id: activeView
        path: root.activePath
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
                root.activeSceneData = j.shader || {};
                root.shaderState  = JSON.parse(JSON.stringify(j.shader  || {}));
                root.harnessState = j.harness || {};
                root.applyState();
                root.rebuildSections();
                root.uniformsRev += 1;
                root.dirty = false;
            } catch (e) {
                console.warn("active scene parse error:", e.message);
            }
        }
        onSaveFailed: function (err) {
            console.warn("active scene save failed:", err);
        }
    }

    FileView {
        id: targetView
        path: root.targetPath
        blockLoading: false
        watchChanges: true

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
                root.targetSceneData = j.shader || {};
            } catch (e) {
                console.warn("target scene parse error:", e.message);
            }
        }
        onSaveFailed: function (err) {
            console.warn("target scene save failed:", err);
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
        property real fastBackSunStrength: 0.0
        property real fastBackSunSize: 0.18
        property real fastBackSunFrequency: 0.3
        property real fastBackSunSpeed: 1.0
        property real fastBackSunPaletteSpeed: 1.0
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
        // Single-window preview: xy offset = 0, zw = full window size,
        // so the new frag formula reduces to qt_TexCoord0 * iResolution.
        property vector4d windowGeom: Qt.vector4d(0, 0, width, height)
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

                // Scene file controls (Open / Save / Save As for active).
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 4

                    Text {
                        Layout.fillWidth: true
                        color: "#cfcfcf"
                        font.family: "monospace"
                        font.pixelSize: 10
                        text: "editing: " + root.basename(root.activePath) + (root.dirty ? "  •" : "")
                        elide: Text.ElideMiddle
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 4

                    Button {
                        Layout.fillWidth: true
                        text: "Open…"
                        onClicked: scenePicker.openFor("openActive")
                    }
                    Button {
                        Layout.fillWidth: true
                        text: "Save"
                        enabled: root.dirty
                        onClicked: root.persist()
                    }
                    Button {
                        Layout.fillWidth: true
                        text: "Save as…"
                        onClicked: scenePicker.openFor("saveAs")
                    }
                }

                // Target scene + flip controls.
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 4

                    Text {
                        Layout.fillWidth: true
                        color: "#9090b0"
                        font.family: "monospace"
                        font.pixelSize: 10
                        text: "target: " + root.basename(root.targetPath)
                        elide: Text.ElideMiddle
                    }
                    Button {
                        text: "Browse…"
                        onClicked: scenePicker.openFor("openTarget")
                    }
                }

                Button {
                    Layout.fillWidth: true
                    text: {
                        if (root.flipActive) return "flipping…";
                        return "Flip → " + root.basename(root.targetPath);
                    }
                    enabled: !root.flipActive
                    onClicked: root.triggerFlip()
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

            // Live-bound to shaderState[d.key] so picker drags update
            // the swatch and hex field instantly. The binding
            // re-evaluates each time setValue() reassigns shaderState
            // (which is how the picker pushes its updates).
            readonly property string liveValue: {
                const v = root.shaderState[d.key];
                return (v && typeof v === "string") ? v : d.value;
            }
            readonly property bool liveValid: /^#[0-9a-fA-F]{6}$/.test(liveValue)

            // Clickable swatch — opens the colour-picker popup configured
            // to edit this row's key.
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
                    onClicked: colorPicker.openFor(d.section, d.key, liveValue)
                }
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
                // Bind to liveValue but DON'T overwrite while user is
                // actively focused (else mid-typing edits get clobbered
                // by external picker updates). Read-only sync handled
                // by the Binding-when-not-focused block below.
                text: liveValue
                selectByMouse: true
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
