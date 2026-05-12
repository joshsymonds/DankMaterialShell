pragma Singleton
pragma ComponentBehavior: Bound

import QtCore
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
// Two-tier file backing per scene:
//   - canonical: quickshell/Shaders/scenes/<name>.json — ships with DMS.
//   - shadow:    $XDG_STATE_HOME/DankMaterialShell/scenes/<name>.json — writable.
//
// On load, shadow wins if present (so user edits persist across DMS
// restarts even when DMS itself lives in a read-only path like /nix/store).
// Saves always go to the shadow. To bless a shadow as canonical, copy
// the shadow file into the DMS source's scene file and delete the
// shadow.

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

    // Writable shadow under XDG state. Saves go here; loads prefer it
    // over the canonical when present.
    readonly property string shadowDir: {
        return StandardPaths.writableLocation(StandardPaths.GenericStateLocation) + "/DankMaterialShell/scenes/";
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
            wallpaperShadowFileView.ourWrite = true;
            wallpaperShadowFileView.setText(_serialize("wallpaper"));
            paths = Object.assign({}, paths, withKey(name, wallpaperShadowFileView.path));
        }
        // Future scenes are added here as additional FileViews + cases.
        dirty = Object.assign({}, dirty, withKey(name, false));
    }

    function saveAs(name, path) {
        if (name === "wallpaper") {
            wallpaperShadowFileView.ourWrite = true;
            wallpaperShadowFileView.path = path;
            wallpaperShadowFileView.setText(_serialize("wallpaper"));
            paths = Object.assign({}, paths, withKey(name, path));
        }
        dirty = Object.assign({}, dirty, withKey(name, false));
    }

    // Shadow first. On load failure (shadow missing), fall back to
    // canonical. After that, saves go to the shadow and we watch the
    // shadow for external edits.
    FileView {
        id: wallpaperShadowFileView
        path: root.shadowDir + "wallpaper.json"
        blockLoading: false
        blockWrites: true
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
                console.warn("SceneStateService: parse error for wallpaper shadow:", e.message);
            }
        }
        onLoadFailed: error => {
            wallpaperCanonicalFileView.reload();
        }
    }

    FileView {
        id: wallpaperCanonicalFileView
        path: root.scenesDir + "wallpaper.json"
        blockLoading: false
        watchChanges: false
        onLoaded: {
            try {
                const j = JSON.parse(text());
                // Even though we loaded from canonical, future saves
                // go to the shadow — point "paths" at the shadow so
                // the rest of the system uses it.
                root._ingest("wallpaper",
                             j.shader || {},
                             j.harness || {},
                             wallpaperShadowFileView.path);
            } catch (e) {
                console.warn("SceneStateService: parse error for wallpaper canonical:", e.message);
            }
        }
    }
}
