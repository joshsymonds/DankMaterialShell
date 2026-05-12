pragma Singleton
pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

// In-memory store for chrome-shader scenes. Loads scene JSON files
// on startup, exposes their contents as reactive properties, and
// writes back to disk on save. Surfaces (wallpaper, bar, popouts)
// and the in-DMS editor share the same singleton — slider drags in
// the editor mutate scenes here, and surface bindings re-evaluate
// instantly, no file round-trip.
//
// Per-surface scenes:
//   scenes.wallpaper.data    — { intensity, cellSize, ... }
//   scenes.wallpaper.harness — { speed }
//   scenes.bar.data          — (future)
//   ...
//
// File backing is one JSON per scene under quickshell/Shaders/scenes/.

Singleton {
    id: root

    // The scene store. Each entry has shape { data: {...}, harness: {...} }.
    // Reassigned (not mutated in place) so QML bindings on
    // SceneStateService.scenes.<name>.data.<key> re-evaluate when set
    // is called.
    property var scenes: ({})
    // Map of scene name → file path (filesystem, no file:// prefix).
    property var paths: ({})
    // Map of scene name → boolean dirty flag (true = unsaved edits).
    property var dirty: ({})

    // Resolved at startup; the directory containing committed scene files.
    readonly property string scenesDir: {
        const u = Qt.resolvedUrl("../Shaders/scenes/").toString();
        return u.replace(/^file:\/\//, "");
    }

    function get(name) {
        const s = scenes[name];
        return s || { data: {}, harness: {} };
    }

    function isDirty(name) {
        return dirty[name] === true;
    }

    // Update one key in a scene. section is "shader" (default) or "harness".
    // Reassigns scenes so bindings re-evaluate.
    function setValue(name, key, value, section) {
        section = section || "shader";
        const cur = scenes[name] || { data: {}, harness: {} };
        const oldData    = cur.data    || {};
        const oldHarness = cur.harness || {};
        let newData    = oldData;
        let newHarness = oldHarness;
        if (section === "shader") {
            newData = Object.assign({}, oldData);
            newData[key] = value;
        } else {
            newHarness = Object.assign({}, oldHarness);
            newHarness[key] = value;
        }
        const newScenes = Object.assign({}, scenes);
        newScenes[name] = { data: newData, harness: newHarness };
        scenes = newScenes;
        dirty  = Object.assign({}, dirty, withKey(name, true));
    }

    // Helper: build a single-key object inline (avoids computed-property
    // syntax for older QML JS engines).
    function withKey(k, v) {
        const o = {}; o[k] = v; return o;
    }

    // Wholesale replace a scene (used on disk reload). Doesn't mark
    // dirty since this IS the on-disk state.
    function _ingest(name, data, harness, path) {
        const newScenes = Object.assign({}, scenes);
        newScenes[name] = { data: data || {}, harness: harness || {} };
        scenes = newScenes;
        if (path !== undefined) {
            paths = Object.assign({}, paths, withKey(name, path));
        }
        dirty = Object.assign({}, dirty, withKey(name, false));
    }

    function _serialize(name) {
        const s = scenes[name] || { data: {}, harness: {} };
        return JSON.stringify({
            "_comment": "Edited via DMS scene editor. Live-reloaded by surfaces watching this file.",
            "_schema":  "Keys under .shader MUST match std140 uniform names in the .frag exactly.",
            shader:  s.data,
            harness: s.harness
        }, null, 2) + "\n";
    }

    function save(name) {
        if (name === "wallpaper") {
            wallpaperFileView.ourWrite = true;
            wallpaperFileView.setText(_serialize("wallpaper"));
        }
        // Future scenes are added here as additional FileViews + cases.
        dirty = Object.assign({}, dirty, withKey(name, false));
    }

    function saveAs(name, path) {
        if (name === "wallpaper") {
            wallpaperFileView.ourWrite = true;
            wallpaperFileView.path = path;
            wallpaperFileView.setText(_serialize("wallpaper"));
            paths = Object.assign({}, paths, withKey(name, path));
        }
        dirty = Object.assign({}, dirty, withKey(name, false));
    }

    // Hardcoded scene FileViews. To add a surface, declare a new
    // FileView here pointing at its scene file and add a case in
    // save() / saveAs() above.
    FileView {
        id: wallpaperFileView
        path: root.scenesDir + "wallpaper.json"
        blockLoading: false
        watchChanges: true
        property bool ourWrite: false
        onFileChanged: {
            if (ourWrite) { ourWrite = false; return; }
            reload();
        }
        onLoaded: {
            try {
                const j = JSON.parse(text());
                root._ingest("wallpaper",
                             j.shader || {},
                             j.harness || {},
                             path);
            } catch (e) {
                console.warn("SceneStateService: parse error for wallpaper:", e.message);
            }
        }
    }
}
