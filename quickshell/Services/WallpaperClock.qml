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

    FrameAnimation {
        running: true
        onTriggered: root.iTime += frameTime * root.speed
    }
}
