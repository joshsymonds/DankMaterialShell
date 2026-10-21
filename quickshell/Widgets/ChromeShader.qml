pragma ComponentBehavior: Bound

import QtQuick
import qs.Common

// Reusable animated procedural shader background for DMS chrome surfaces.
//
// Designed to be dropped on any chrome surface (bar, dock, popouts, modals,
// wallpaper) without modification. The host surface is responsible for
// masking/clipping if it has non-rectangular geometry — typically by wrapping
// this in a MultiEffect with a maskSource matching the surface's painted shape.
//
// Color sources:
//   By default the shader pulls colors from Theme.{primary,secondary,
//   primaryContainer,tertiary} so matugen palette regenerations propagate
//   automatically via QML bindings. Hosts can override any of the four color
//   knobs to bypass matugen for surfaces that want hand-picked accents (e.g.
//   matching a wallpaper's actual saturated colors when matugen has flattened
//   them into muted tones).
//
// Public knobs:
//   intensity                — alpha multiplier 0..1 (how strongly the shader
//                              veils the surface)
//   speed                    — time scaling, default 1.0
//   mode                     — string identifier selecting which fragmentShader
//                              runs ("test" | "aurora" | "hexrain")
//   running                  — gate FrameAnimation; default true
//   cellSize                 — hexrain hex radius in px (only used by hexrain mode)
//   primaryColor             — band hue A in veil cores; defaults to Theme.primary
//   secondaryColor           — band hue B in veil cores; defaults to Theme.secondary
//   primaryContainerColor    — muted base color in dark zones; defaults to
//                              Theme.primaryContainer
//   tertiaryColor            — bright highlight color at veil peaks; defaults
//                              to Theme.tertiary
Item {
    id: root

    property real intensity: 0.6
    property real speed: 1.0
    property string mode: "test"
    property bool running: true
    property real cellSize: 14

    // Time source. Default: internal FrameAnimation ticks `iTime` at
    // `frameTime * speed` per frame. For multi-monitor wallpaper, set
    // `autoTime: false` and bind `iTime` to a shared singleton so both
    // outputs stay in lockstep across the bezel.
    property real iTime: 0
    property bool autoTime: true

    // Virtual-canvas mode (multi-monitor wallpaper). When `virtualWidth`
    // and `virtualHeight` are > 0, the shader treats them as iResolution
    // — the size of the COMBINED canvas spanning all outputs. This
    // window's own pixel slice is positioned via (windowOffsetX,
    // windowOffsetY). Single-monitor consumers leave all four at 0.
    property real virtualWidth: 0
    property real virtualHeight: 0
    property real windowOffsetX: 0
    property real windowOffsetY: 0

    // Alt mode (chrome_hexrain). modeAmount=0 preserves the original
    // 2D matrix-rain bar look; modeAmount=1 switches to the
    // height-leak look driven by drifting point-light "suns" behind
    // a hex grid where each cell sits at its own elevation. Bar
    // consumers leave at defaults; wallpaper consumers drive
    // modeAmount to 1.0.
    property real modeAmount: 0.0
    property real domeStrength: 0.8
    property real seamGlow: 1.5
    property real sunDriftSpeed: 1.0
    property real heightAmount: 0.0
    property real matteness: 0.70
    property real hexBevel: 0.6
    property real heightDriftSpeed: 0.0
    // Sun motion: each slot fades in, wanders along a Perlin-noise
    // path for <type>SunLifetime seconds, fades out, then sits
    // invisibly for <type>SunGap seconds before a new appearance
    // starts from a different place. <type>SunSpeed is the wander
    // rate (low = barely moves). sunDriftSpeed is a global clock
    // multiplier on top of all of this.
    property real frontSunStrength: 0.0
    property real frontSunSize: 0.3
    property real frontSunLifetime: 40.0
    property real frontSunGap: 10.0
    property real frontSunSpeed: 0.02
    property real backSunSize: 0.4
    property real backSunStrength: 1.0
    property real backSunLifetime: 45.0
    property real backSunGap: 12.0
    property real backSunSpeed: 0.02
    property real backNegSunSize: 0.3
    property real backNegSunStrength: 0.0
    property real backNegSunLifetime: 35.0
    property real backNegSunGap: 18.0
    property real backNegSunSpeed: 0.02
    property real backSunPaletteSpeed: 0.0
    property real frontSunPaletteSpeed: 0.0
    property real backSunCount: 3
    property real backNegSunCount: 1
    property real frontSunCount: 1
    property real frontNegSunCount: 0
    property real frontNegSunStrength: 0.7
    property real frontNegSunSize: 0.3
    property real frontNegSunLifetime: 30.0
    property real frontNegSunGap: 15.0
    property real frontNegSunSpeed: 0.02

    // Fast back sun: single-slot zippy streak, lives outside the slow
    // back-sun pool with its own knobs. Default off (strength = 0).
    property real fastBackSunStrength: 0.0
    property real fastBackSunSize: 0.25
    property real fastBackSunLifetime: 6.0
    property real fastBackSunGap: 12.0
    property real fastBackSunSpeed: 0.18

    // Bar-zone elevation: raises hexes in a horizontal strip anchored
    // to the top or bottom of each output. Feeds the height-leak
    // model so the strip emerges as a raised platform with glowing
    // seams and cast shadows onto surrounding wallpaper hexes.
    // Default off; the taskbar surface enables it on the wallpaper.
    property real barZoneEnabled: 0.0
    property real barZoneAnchor: 0.0     // 0 = top, 1 = bottom, 2 = left, 3 = right
    property real barZoneThickness: 60.0 // pixels (height for top/bottom; width for left/right)
    property real barZoneElevation: 0.5  // height-field bump

    // Palette flip — staging colours + propagating-ripple parameters.
    // While not flipping, the four Next colours should match the
    // four Current colours; the wave shows a visible transition only
    // when they differ and flipStartTime is set to a recent iTime.
    // flipStartTime < 0 (or any large-negative sentinel) effectively
    // means "the wave has already finished" so the field renders as
    // the Next palette = Current palette (no animation).
    property color primaryNextColor: primaryColor
    property color secondaryNextColor: secondaryColor
    property color primaryContainerNextColor: primaryContainerColor
    property color tertiaryNextColor: tertiaryColor
    property real flipOriginX: 0.0
    property real flipOriginY: 0.0
    // Far-future sentinel: at idle, iTime never reaches flipStartTime,
    // so per-hex phase clamps to 0 and the field renders the Current
    // palette. Set to a real iTime to start a wave.
    property real flipStartTime: 1.0e9
    property real flipPropDelay: 0.05
    property real flipDuration: 0.5

    // 3D scale field (hexrain).
    property real heightRange: 7.0
    property real tiltMax: 0.12
    property real tiltDriftSpeed: 0.5
    property real slabThickness: 4.0
    property real domeHeight: 8.0
    property real cameraDistance: 5000.0
    property real frontSunHeight: 500.0
    property real grainScale: 0.3
    property real grainStrength: 0.4
    property real rimGlow: 0.8
    property real keyLight: 0.6
    property real scaleShadow: 0.7
    property real seamBase: 0.3
    property real occlusion: 0.6

    property color primaryColor: Theme.primary
    property color secondaryColor: Theme.secondary
    property color primaryContainerColor: Theme.primaryContainer
    property color tertiaryColor: Theme.tertiary

    readonly property url shaderSource: {
        switch (mode) {
        case "test":
            return Qt.resolvedUrl("../Shaders/qsb/chrome_test.frag.qsb");
        case "aurora":
            return Qt.resolvedUrl("../Shaders/qsb/chrome_aurora.frag.qsb");
        case "hexrain":
            return Qt.resolvedUrl("../Shaders/qsb/chrome_hexrain.frag.qsb");
        default:
            return "";
        }
    }
    // Unknown modes (e.g. "none") render nothing. Skip creating the effect
    // and stop the clock: an empty fragmentShader falls back to Qt's default
    // texture shader, and a running FrameAnimation repaints every frame.
    readonly property bool hasShader: shaderSource.toString() !== ""

    Loader {
        anchors.fill: parent
        active: root.hasShader
        sourceComponent: HexrainEffect {
            passesEnabled: root.mode === "hexrain"
            iTime: root.iTime
            intensity: root.intensity
            cellSize: root.cellSize
            modeAmount: root.modeAmount
            domeStrength: root.domeStrength
            seamGlow: root.seamGlow
            sunDriftSpeed: root.sunDriftSpeed
            heightAmount: root.heightAmount
            matteness: root.matteness
            hexBevel: root.hexBevel
            heightDriftSpeed: root.heightDriftSpeed
            frontSunStrength: root.frontSunStrength
            frontSunSize: root.frontSunSize
            frontSunLifetime: root.frontSunLifetime
            frontSunGap: root.frontSunGap
            frontSunSpeed: root.frontSunSpeed
            backSunSize: root.backSunSize
            backSunStrength: root.backSunStrength
            backSunLifetime: root.backSunLifetime
            backSunGap: root.backSunGap
            backSunSpeed: root.backSunSpeed
            backNegSunSize: root.backNegSunSize
            backNegSunStrength: root.backNegSunStrength
            backNegSunLifetime: root.backNegSunLifetime
            backNegSunGap: root.backNegSunGap
            backNegSunSpeed: root.backNegSunSpeed
            backSunPaletteSpeed: root.backSunPaletteSpeed
            frontSunPaletteSpeed: root.frontSunPaletteSpeed
            backSunCount: root.backSunCount
            backNegSunCount: root.backNegSunCount
            frontSunCount: root.frontSunCount
            frontNegSunCount: root.frontNegSunCount
            frontNegSunStrength: root.frontNegSunStrength
            frontNegSunSize: root.frontNegSunSize
            frontNegSunLifetime: root.frontNegSunLifetime
            frontNegSunGap: root.frontNegSunGap
            frontNegSunSpeed: root.frontNegSunSpeed
            fastBackSunStrength: root.fastBackSunStrength
            fastBackSunSize: root.fastBackSunSize
            fastBackSunLifetime: root.fastBackSunLifetime
            fastBackSunGap: root.fastBackSunGap
            fastBackSunSpeed: root.fastBackSunSpeed
            barZoneEnabled: root.barZoneEnabled
            barZoneAnchor: root.barZoneAnchor
            barZoneThickness: root.barZoneThickness
            barZoneElevation: root.barZoneElevation
            flipOriginX: root.flipOriginX
            flipOriginY: root.flipOriginY
            flipStartTime: root.flipStartTime
            flipPropDelay: root.flipPropDelay
            flipDuration: root.flipDuration
            heightRange: root.heightRange
            tiltMax: root.tiltMax
            tiltDriftSpeed: root.tiltDriftSpeed
            slabThickness: root.slabThickness
            domeHeight: root.domeHeight
            cameraDistance: root.cameraDistance
            frontSunHeight: root.frontSunHeight
            grainScale: root.grainScale
            grainStrength: root.grainStrength
            rimGlow: root.rimGlow
            keyLight: root.keyLight
            scaleShadow: root.scaleShadow
            seamBase: root.seamBase
            occlusion: root.occlusion
            // iResolution = the canvas the shader thinks it's painting on.
            // For single-monitor surfaces this is just the local size; for
            // the multi-monitor wallpaper it's the combined bounding box of
            // all outputs (so sun centres, drift radii, hex tiling, and the
            // flip wave all live in one continuous space).
            iResolution: Qt.vector3d(
                root.virtualWidth  > 0 ? root.virtualWidth  : width,
                root.virtualHeight > 0 ? root.virtualHeight : height,
                1)
            // xy = this window's top-left in the virtual canvas; zw = this
            // window's actual pixel size. The frag computes
            //   px = qt_TexCoord0 * windowGeom.zw + windowGeom.xy
            // so each output renders the correct slice of one shared field.
            windowGeom: Qt.vector4d(
                root.windowOffsetX, root.windowOffsetY,
                width, height)
            colorPrimary: Qt.vector4d(root.primaryColor.r, root.primaryColor.g, root.primaryColor.b, root.primaryColor.a)
            colorSecondary: Qt.vector4d(root.secondaryColor.r, root.secondaryColor.g, root.secondaryColor.b, root.secondaryColor.a)
            colorPrimaryContainer: Qt.vector4d(root.primaryContainerColor.r, root.primaryContainerColor.g, root.primaryContainerColor.b, root.primaryContainerColor.a)
            colorTertiary: Qt.vector4d(root.tertiaryColor.r, root.tertiaryColor.g, root.tertiaryColor.b, root.tertiaryColor.a)
            colorPrimaryNext: Qt.vector4d(root.primaryNextColor.r, root.primaryNextColor.g, root.primaryNextColor.b, root.primaryNextColor.a)
            colorSecondaryNext: Qt.vector4d(root.secondaryNextColor.r, root.secondaryNextColor.g, root.secondaryNextColor.b, root.secondaryNextColor.a)
            colorPrimaryContainerNext: Qt.vector4d(root.primaryContainerNextColor.r, root.primaryContainerNextColor.g, root.primaryContainerNextColor.b, root.primaryContainerNextColor.a)
            colorTertiaryNext: Qt.vector4d(root.tertiaryNextColor.r, root.tertiaryNextColor.g, root.tertiaryNextColor.b, root.tertiaryNextColor.a)

            fragmentShader: root.shaderSource
        }
    }

    FrameAnimation {
        running: root.running && root.autoTime && root.hasShader
        onTriggered: root.iTime += frameTime * root.speed
    }
}
