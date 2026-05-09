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
//                              runs ("test" | "aurora")
//   running                  — gate FrameAnimation; default true
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

    property color primaryColor: Theme.primary
    property color secondaryColor: Theme.secondary
    property color primaryContainerColor: Theme.primaryContainer
    property color tertiaryColor: Theme.tertiary

    ShaderEffect {
        id: shaderEffect
        anchors.fill: parent

        property real iTime: 0
        property real intensity: root.intensity
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
