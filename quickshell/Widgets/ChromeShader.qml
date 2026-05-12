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
    property real bleedBack: 0.03
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
    property real frontSunShadowLength: 1.0
    property real frontSunShadowDarkness: 0.85
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
    property real barZoneAnchor: 0.0     // 0 = top, 1 = bottom
    property real barZoneThickness: 60.0 // pixels
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
    property real depthShading: 0.35
    property real flipSpecular: 0.8
    property real hexDepth: 0.7

    property color primaryColor: Theme.primary
    property color secondaryColor: Theme.secondary
    property color primaryContainerColor: Theme.primaryContainer
    property color tertiaryColor: Theme.tertiary

    ShaderEffect {
        id: shaderEffect
        anchors.fill: parent

        property real iTime: root.iTime
        property real intensity: root.intensity
        property real cellSize: root.cellSize
        property real modeAmount: root.modeAmount
        property real domeStrength: root.domeStrength
        property real seamGlow: root.seamGlow
        property real sunDriftSpeed: root.sunDriftSpeed
        property real heightAmount: root.heightAmount
        property real matteness: root.matteness
        property real bleedBack: root.bleedBack
        property real hexBevel: root.hexBevel
        property real heightDriftSpeed: root.heightDriftSpeed
        property real frontSunStrength: root.frontSunStrength
        property real frontSunSize: root.frontSunSize
        property real frontSunLifetime: root.frontSunLifetime
        property real frontSunGap: root.frontSunGap
        property real frontSunSpeed: root.frontSunSpeed
        property real frontSunShadowLength: root.frontSunShadowLength
        property real frontSunShadowDarkness: root.frontSunShadowDarkness
        property real backSunSize: root.backSunSize
        property real backSunStrength: root.backSunStrength
        property real backSunLifetime: root.backSunLifetime
        property real backSunGap: root.backSunGap
        property real backSunSpeed: root.backSunSpeed
        property real backNegSunSize: root.backNegSunSize
        property real backNegSunStrength: root.backNegSunStrength
        property real backNegSunLifetime: root.backNegSunLifetime
        property real backNegSunGap: root.backNegSunGap
        property real backNegSunSpeed: root.backNegSunSpeed
        property real backSunPaletteSpeed: root.backSunPaletteSpeed
        property real frontSunPaletteSpeed: root.frontSunPaletteSpeed
        property real backSunCount: root.backSunCount
        property real backNegSunCount: root.backNegSunCount
        property real frontSunCount: root.frontSunCount
        property real frontNegSunCount: root.frontNegSunCount
        property real frontNegSunStrength: root.frontNegSunStrength
        property real frontNegSunSize: root.frontNegSunSize
        property real frontNegSunLifetime: root.frontNegSunLifetime
        property real frontNegSunGap: root.frontNegSunGap
        property real frontNegSunSpeed: root.frontNegSunSpeed
        property real fastBackSunStrength: root.fastBackSunStrength
        property real fastBackSunSize: root.fastBackSunSize
        property real fastBackSunLifetime: root.fastBackSunLifetime
        property real fastBackSunGap: root.fastBackSunGap
        property real fastBackSunSpeed: root.fastBackSunSpeed
        property real barZoneEnabled: root.barZoneEnabled
        property real barZoneAnchor: root.barZoneAnchor
        property real barZoneThickness: root.barZoneThickness
        property real barZoneElevation: root.barZoneElevation
        property real flipOriginX: root.flipOriginX
        property real flipOriginY: root.flipOriginY
        property real flipStartTime: root.flipStartTime
        property real flipPropDelay: root.flipPropDelay
        property real flipDuration: root.flipDuration
        property real depthShading: root.depthShading
        property real flipSpecular: root.flipSpecular
        property real hexDepth: root.hexDepth
        // iResolution = the canvas the shader thinks it's painting on.
        // For single-monitor surfaces this is just the local size; for
        // the multi-monitor wallpaper it's the combined bounding box of
        // all outputs (so sun centres, drift radii, hex tiling, and the
        // flip wave all live in one continuous space).
        property vector3d iResolution: Qt.vector3d(
            root.virtualWidth  > 0 ? root.virtualWidth  : width,
            root.virtualHeight > 0 ? root.virtualHeight : height,
            1)
        // xy = this window's top-left in the virtual canvas; zw = this
        // window's actual pixel size. The frag computes
        //   px = qt_TexCoord0 * windowGeom.zw + windowGeom.xy
        // so each output renders the correct slice of one shared field.
        property vector4d windowGeom: Qt.vector4d(
            root.windowOffsetX, root.windowOffsetY,
            width, height)
        property vector4d colorPrimary: Qt.vector4d(root.primaryColor.r, root.primaryColor.g, root.primaryColor.b, root.primaryColor.a)
        property vector4d colorSecondary: Qt.vector4d(root.secondaryColor.r, root.secondaryColor.g, root.secondaryColor.b, root.secondaryColor.a)
        property vector4d colorPrimaryContainer: Qt.vector4d(root.primaryContainerColor.r, root.primaryContainerColor.g, root.primaryContainerColor.b, root.primaryContainerColor.a)
        property vector4d colorTertiary: Qt.vector4d(root.tertiaryColor.r, root.tertiaryColor.g, root.tertiaryColor.b, root.tertiaryColor.a)
        property vector4d colorPrimaryNext: Qt.vector4d(root.primaryNextColor.r, root.primaryNextColor.g, root.primaryNextColor.b, root.primaryNextColor.a)
        property vector4d colorSecondaryNext: Qt.vector4d(root.secondaryNextColor.r, root.secondaryNextColor.g, root.secondaryNextColor.b, root.secondaryNextColor.a)
        property vector4d colorPrimaryContainerNext: Qt.vector4d(root.primaryContainerNextColor.r, root.primaryContainerNextColor.g, root.primaryContainerNextColor.b, root.primaryContainerNextColor.a)
        property vector4d colorTertiaryNext: Qt.vector4d(root.tertiaryNextColor.r, root.tertiaryNextColor.g, root.tertiaryNextColor.b, root.tertiaryNextColor.a)

        fragmentShader: {
            switch (root.mode) {
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
    }

    FrameAnimation {
        running: root.running && root.autoTime
        onTriggered: root.iTime += frameTime * root.speed
    }
}
