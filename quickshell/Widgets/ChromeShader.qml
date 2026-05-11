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
    property real frontSunStrength: 0.0
    property real frontSunSpeed: 0.0
    property real frontSunSize: 0.3
    property real frontSunShadowLength: 1.0
    property real frontSunShadowDarkness: 0.85
    property real backSunSize: 0.4
    property real backSunStrength: 1.0

    property color primaryColor: Theme.primary
    property color secondaryColor: Theme.secondary
    property color primaryContainerColor: Theme.primaryContainer
    property color tertiaryColor: Theme.tertiary

    ShaderEffect {
        id: shaderEffect
        anchors.fill: parent

        property real iTime: 0
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
        property real frontSunSpeed: root.frontSunSpeed
        property real frontSunSize: root.frontSunSize
        property real frontSunShadowLength: root.frontSunShadowLength
        property real frontSunShadowDarkness: root.frontSunShadowDarkness
        property real backSunSize: root.backSunSize
        property real backSunStrength: root.backSunStrength
        property vector3d iResolution: Qt.vector3d(width, height, 1)
        property vector4d colorPrimary: Qt.vector4d(root.primaryColor.r, root.primaryColor.g, root.primaryColor.b, root.primaryColor.a)
        property vector4d colorSecondary: Qt.vector4d(root.secondaryColor.r, root.secondaryColor.g, root.secondaryColor.b, root.secondaryColor.a)
        property vector4d colorPrimaryContainer: Qt.vector4d(root.primaryContainerColor.r, root.primaryContainerColor.g, root.primaryContainerColor.b, root.primaryContainerColor.a)
        property vector4d colorTertiary: Qt.vector4d(root.tertiaryColor.r, root.tertiaryColor.g, root.tertiaryColor.b, root.tertiaryColor.a)

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
        running: root.running
        onTriggered: shaderEffect.iTime += frameTime * root.speed
    }
}
