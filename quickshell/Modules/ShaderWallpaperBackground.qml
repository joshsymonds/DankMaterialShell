import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Services
import qs.Widgets

// Full-screen shader-driven wallpaper. Reads uniforms from
// SceneStateService.scenes.wallpaper.{data,harness} — that singleton
// is the live source of truth, edited in-memory by the scene editor.
// Every property here is a direct binding on the service, so editor
// changes propagate to the GPU as fast as QML can rebind (no file
// round-trip).

Variants {
    model: Quickshell.screens

    PanelWindow {
        id: shaderWallpaperWindow

        required property var modelData
        screen: modelData

        WlrLayershell.layer: WlrLayer.Background
        WlrLayershell.exclusionMode: ExclusionMode.Ignore

        anchors.top: true
        anchors.bottom: true
        anchors.left: true
        anchors.right: true

        color: "transparent"

        readonly property var sceneData:    SceneStateService.scenes.wallpaper ? SceneStateService.scenes.wallpaper.data    : ({})
        readonly property var sceneHarness: SceneStateService.scenes.wallpaper ? SceneStateService.scenes.wallpaper.harness : ({})

        // Bounding box of every connected output in compositor coords.
        // Used to size the virtual canvas the shader paints onto, and
        // to place this window's slice within it. Recomputes on hotplug
        // because Quickshell.screens is reactive.
        readonly property var virtualBounds: {
            const screens = Quickshell.screens;
            if (!screens || screens.length === 0) {
                return { x: 0, y: 0, w: modelData.width, h: modelData.height };
            }
            let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < screens.length; i++) {
                const s = screens[i];
                if (s.x < minX) minX = s.x;
                if (s.y < minY) minY = s.y;
                const r = s.x + s.width;
                const b = s.y + s.height;
                if (r > maxX) maxX = r;
                if (b > maxY) maxY = b;
            }
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }

        // Helpers: read a key from sceneData/sceneHarness with a fallback.
        function f(d, k, def) { return d[k] !== undefined ? d[k] : def; }

        ChromeShader {
            anchors.fill: parent
            mode: "hexrain"
            running: true

            // Drive every output from one shared clock so motion stays
            // continuous across the bezel even at mismatched refresh
            // rates. Speed is folded into the singleton.
            autoTime: false
            iTime: WallpaperClock.iTime

            // Virtual canvas = bounding box of all outputs. Each window
            // renders its own pixel slice (windowOffsetX/Y) of one big
            // shared field — sun trajectories, hex tiling, and the flip
            // wave all sweep continuously across monitors.
            virtualWidth:  shaderWallpaperWindow.virtualBounds.w
            virtualHeight: shaderWallpaperWindow.virtualBounds.h
            windowOffsetX: shaderWallpaperWindow.modelData.x - shaderWallpaperWindow.virtualBounds.x
            windowOffsetY: shaderWallpaperWindow.modelData.y - shaderWallpaperWindow.virtualBounds.y

            intensity:               shaderWallpaperWindow.f(sceneData, "intensity",              1.0)
            cellSize:                shaderWallpaperWindow.f(sceneData, "cellSize",               14.0)
            modeAmount:              shaderWallpaperWindow.f(sceneData, "modeAmount",             1.0)
            domeStrength:            shaderWallpaperWindow.f(sceneData, "domeStrength",           0.8)
            seamGlow:                shaderWallpaperWindow.f(sceneData, "seamGlow",               1.5)
            sunDriftSpeed:           shaderWallpaperWindow.f(sceneData, "sunDriftSpeed",          1.0)
            heightAmount:            shaderWallpaperWindow.f(sceneData, "heightAmount",           0.0)
            matteness:               shaderWallpaperWindow.f(sceneData, "matteness",              0.70)
            bleedBack:               shaderWallpaperWindow.f(sceneData, "bleedBack",              0.03)
            hexBevel:                shaderWallpaperWindow.f(sceneData, "hexBevel",               0.6)
            heightDriftSpeed:        shaderWallpaperWindow.f(sceneData, "heightDriftSpeed",       0.0)
            frontSunStrength:        shaderWallpaperWindow.f(sceneData, "frontSunStrength",       0.0)
            frontSunSize:            shaderWallpaperWindow.f(sceneData, "frontSunSize",           0.3)
            frontSunLifetime:        shaderWallpaperWindow.f(sceneData, "frontSunLifetime",       40.0)
            frontSunGap:             shaderWallpaperWindow.f(sceneData, "frontSunGap",            10.0)
            frontSunSpeed:           shaderWallpaperWindow.f(sceneData, "frontSunSpeed",          0.02)
            frontSunShadowLength:    shaderWallpaperWindow.f(sceneData, "frontSunShadowLength",   1.0)
            frontSunShadowDarkness:  shaderWallpaperWindow.f(sceneData, "frontSunShadowDarkness", 0.85)
            backSunSize:             shaderWallpaperWindow.f(sceneData, "backSunSize",            0.4)
            backSunStrength:         shaderWallpaperWindow.f(sceneData, "backSunStrength",        1.0)
            backSunLifetime:         shaderWallpaperWindow.f(sceneData, "backSunLifetime",        45.0)
            backSunGap:              shaderWallpaperWindow.f(sceneData, "backSunGap",             12.0)
            backSunSpeed:            shaderWallpaperWindow.f(sceneData, "backSunSpeed",           0.02)
            backNegSunSize:          shaderWallpaperWindow.f(sceneData, "backNegSunSize",         0.3)
            backNegSunStrength:      shaderWallpaperWindow.f(sceneData, "backNegSunStrength",     0.0)
            backNegSunLifetime:      shaderWallpaperWindow.f(sceneData, "backNegSunLifetime",     35.0)
            backNegSunGap:           shaderWallpaperWindow.f(sceneData, "backNegSunGap",          18.0)
            backNegSunSpeed:         shaderWallpaperWindow.f(sceneData, "backNegSunSpeed",        0.02)
            backSunPaletteSpeed:     shaderWallpaperWindow.f(sceneData, "backSunPaletteSpeed",    0.0)
            frontSunPaletteSpeed:    shaderWallpaperWindow.f(sceneData, "frontSunPaletteSpeed",   0.0)
            backSunCount:            shaderWallpaperWindow.f(sceneData, "backSunCount",           3)
            backNegSunCount:         shaderWallpaperWindow.f(sceneData, "backNegSunCount",        1)
            frontSunCount:           shaderWallpaperWindow.f(sceneData, "frontSunCount",          1)
            frontNegSunCount:        shaderWallpaperWindow.f(sceneData, "frontNegSunCount",       0)
            frontNegSunStrength:     shaderWallpaperWindow.f(sceneData, "frontNegSunStrength",    0.7)
            frontNegSunSize:         shaderWallpaperWindow.f(sceneData, "frontNegSunSize",        0.3)
            frontNegSunLifetime:     shaderWallpaperWindow.f(sceneData, "frontNegSunLifetime",    30.0)
            frontNegSunGap:          shaderWallpaperWindow.f(sceneData, "frontNegSunGap",         15.0)
            frontNegSunSpeed:        shaderWallpaperWindow.f(sceneData, "frontNegSunSpeed",       0.02)
            fastBackSunStrength:     shaderWallpaperWindow.f(sceneData, "fastBackSunStrength",    0.0)
            fastBackSunSize:         shaderWallpaperWindow.f(sceneData, "fastBackSunSize",        0.25)
            fastBackSunLifetime:     shaderWallpaperWindow.f(sceneData, "fastBackSunLifetime",    6.0)
            fastBackSunGap:          shaderWallpaperWindow.f(sceneData, "fastBackSunGap",         12.0)
            fastBackSunSpeed:        shaderWallpaperWindow.f(sceneData, "fastBackSunSpeed",       0.18)
            depthShading:            shaderWallpaperWindow.f(sceneData, "depthShading",           0.35)
            flipSpecular:            shaderWallpaperWindow.f(sceneData, "flipSpecular",           0.8)
            hexDepth:                shaderWallpaperWindow.f(sceneData, "hexDepth",               0.7)

            primaryColor:            shaderWallpaperWindow.f(sceneData, "colorPrimary",          "#5897e2")
            secondaryColor:          shaderWallpaperWindow.f(sceneData, "colorSecondary",        "#b711db")
            primaryContainerColor:   shaderWallpaperWindow.f(sceneData, "colorPrimaryContainer", "#171556")
            tertiaryColor:           shaderWallpaperWindow.f(sceneData, "colorTertiary",         "#39ff99")
            primaryNextColor:           shaderWallpaperWindow.f(sceneData, "colorPrimaryNext",           primaryColor)
            secondaryNextColor:         shaderWallpaperWindow.f(sceneData, "colorSecondaryNext",         secondaryColor)
            primaryContainerNextColor:  shaderWallpaperWindow.f(sceneData, "colorPrimaryContainerNext",  primaryContainerColor)
            tertiaryNextColor:          shaderWallpaperWindow.f(sceneData, "colorTertiaryNext",          tertiaryColor)

            flipOriginX:    shaderWallpaperWindow.f(sceneData, "flipOriginX",    0.0)
            flipOriginY:    shaderWallpaperWindow.f(sceneData, "flipOriginY",    0.0)
            flipStartTime:  shaderWallpaperWindow.f(sceneData, "flipStartTime",  1.0e9)
            flipPropDelay:  shaderWallpaperWindow.f(sceneData, "flipPropDelay",  0.08)
            flipDuration:   shaderWallpaperWindow.f(sceneData, "flipDuration",   0.7)

            speed: shaderWallpaperWindow.f(sceneHarness, "speed", 1.0)
        }
    }
}
