import QtQuick
import qs.Common

// Reusable animated procedural shader background for DMS chrome surfaces.
//
// Designed to be dropped on any chrome surface (bar, dock, popouts, modals,
// wallpaper) without modification. The host surface is responsible for
// masking/clipping if it has non-rectangular geometry — typically by wrapping
// this in a MultiEffect with a maskSource matching the surface's painted shape.
//
// Theme color uniforms are bound directly to Theme Singleton properties, so
// matugen palette regenerations propagate automatically via QML bindings.
//
// Public knobs:
//   intensity  — alpha multiplier 0..1 (how strongly the shader veils the surface)
//   speed      — time scaling, default 1.0 (per-frame iTime increment scaled)
//   mode       — string identifier selecting which fragmentShader runs
Item {
    id: root

    property real intensity: 0.6
    property real speed: 1.0
    property string mode: "test"
    property bool running: true

    ShaderEffect {
        id: shaderEffect
        anchors.fill: parent

        property real iTime: 0
        property real intensity: root.intensity
        property vector3d iResolution: Qt.vector3d(width, height, 1)
        property vector4d colorPrimary: Qt.vector4d(Theme.primary.r, Theme.primary.g, Theme.primary.b, Theme.primary.a)
        property vector4d colorSecondary: Qt.vector4d(Theme.secondary.r, Theme.secondary.g, Theme.secondary.b, Theme.secondary.a)
        property vector4d colorPrimaryContainer: Qt.vector4d(Theme.primaryContainer.r, Theme.primaryContainer.g, Theme.primaryContainer.b, Theme.primaryContainer.a)

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
