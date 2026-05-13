pragma Singleton
pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import qs.Services

// Single shared clock for the multi-monitor wallpaper shader. Both
// per-screen instances bind their iTime to this singleton so the
// visual stays in lockstep across the bezel — without a shared clock,
// each window's local FrameAnimation ticks on its own output's vblank,
// and at mismatched refresh rates the two sides desync (a sun
// "teleports" 15-30ms as it crosses).
//
// `speed` follows the wallpaper scene's harness.speed, so the editor's
// speed slider continues to work transparently.

Singleton {
    id: root

    property real iTime: 0
    readonly property real speed: {
        const s = SceneStateService.scenes.wallpaper;
        if (s && s.harness && s.harness.speed !== undefined)
            return s.harness.speed;
        return 1.0;
    }

    // Target wallpaper refresh rate. The hexrain effect is slow ambient
    // drift — running it at the monitor's full vsync (144Hz+) is wasted
    // GPU. At 30Hz the motion is visually indistinguishable but the
    // fragment shader runs ~5x less often on a high-refresh panel.
    // The accumulator below batches frameTime so iTime advances in
    // ~targetInterval chunks, which is what triggers the QSG redraw.
    property real targetFps: 30.0
    readonly property real targetInterval: 1.0 / targetFps
    property real _accum: 0

    FrameAnimation {
        running: true
        onTriggered: {
            root._accum += frameTime;
            if (root._accum >= root.targetInterval) {
                root.iTime += root._accum * root.speed;
                root._accum = 0;
            }
        }
    }
}
