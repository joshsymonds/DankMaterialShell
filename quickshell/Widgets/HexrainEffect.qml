import QtQuick
import "../Common/HexrainGrid.js" as HexrainGrid
import "../Common/SunField.js" as SunField

// ShaderEffect for the chrome shaders (chrome_hexrain / _aurora / _test).
// Declares every uniform they read, so hosts just assign values.
//
// For chrome_hexrain (passesEnabled) it also runs the two pre-passes the
// main pass samples each frame:
//   cellTex  — chrome_hexrain_cells.frag, one texel per hex cell edge
//   lightTex — chrome_hexrain_light.frag, the sun field on a coarse grid
// and computes the frame's sun placements once on the CPU (SunField.js),
// handing them to the passes as per-slot uniforms.
ShaderEffect {
    id: root

    property bool passesEnabled: true

    property real iTime: 0
    property vector3d iResolution: Qt.vector3d(width, height, 1)
    // xy = this surface's offset in the virtual canvas, zw = its size.
    property vector4d windowGeom: Qt.vector4d(0, 0, width, height)
    property vector4d colorPrimary: Qt.vector4d(0, 0, 0, 1)
    property vector4d colorSecondary: Qt.vector4d(0, 0, 0, 1)
    property vector4d colorPrimaryContainer: Qt.vector4d(0, 0, 0, 1)
    property vector4d colorTertiary: Qt.vector4d(0, 0, 0, 1)
    property vector4d colorPrimaryNext: colorPrimary
    property vector4d colorSecondaryNext: colorSecondary
    property vector4d colorPrimaryContainerNext: colorPrimaryContainer
    property vector4d colorTertiaryNext: colorTertiary

    // Sun motion (lifetime/gap/speed) is consumed by SunField.js; see
    // placement() there for the appearance cycle.
    property real intensity: 0.6
    property real cellSize: 14
    property real modeAmount: 0.0
    property real domeStrength: 0.8
    property real seamGlow: 1.5
    property real sunDriftSpeed: 1.0
    property real heightAmount: 0.0
    property real matteness: 0.70
    property real hexBevel: 0.6
    property real heightDriftSpeed: 0.0
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
    property real fastBackSunStrength: 0.0
    property real fastBackSunSize: 0.25
    property real fastBackSunLifetime: 6.0
    property real fastBackSunGap: 12.0
    property real fastBackSunSpeed: 0.18
    property real barZoneEnabled: 0.0
    property real barZoneAnchor: 0.0
    property real barZoneThickness: 60.0
    property real barZoneElevation: 0.5
    property real flipOriginX: 0.0
    property real flipOriginY: 0.0
    property real flipStartTime: 1.0e9
    property real flipPropDelay: 0.05
    // 3D scale field.
    property real heightRange: 7.0  // px — scale heights span ±heightRange
    property real tiltMax: 0.12  // rad — largest tilt a scale drifts to
    property real tiltDriftSpeed: 0.5  // tilt drift rate (0 = frozen)
    property real slabThickness: 4.0  // px — scale thickness
    property real domeHeight: 8.0  // px — face bulge at the centre
    property real cameraDistance: 5000.0  // px — camera height; larger = flatter perspective
    property real frontSunHeight: 500.0  // px — front suns' height above the canvas
    property real grainScale: 0.3  // 1/px — matte grain frequency
    property real grainStrength: 0.4  // matte grain relief
    property real rimGlow: 0.8  // underglow caught by scale rims
    property real keyLight: 0.6  // soft upper-left light shaping every scale
    property real scaleShadow: 0.7  // key-light shadows onto lower scales
    property real seamBase: 0.3  // glow through a gap between level neighbours
    property real occlusion: 0.6  // darkening of scales sitting low in the height range
    property real flipDuration: 0.5

    readonly property var grid: HexrainGrid.grid(cellSize, iResolution.x, iResolution.y)
    readonly property real gridCols: grid.cols
    readonly property real gridRows: grid.rows
    readonly property real gridMargin: grid.margin
    readonly property real gridCellTexels: grid.cellTexels
    readonly property real lightCols: grid.lightCols
    readonly property real lightRows: grid.lightRows
    readonly property real lightTexelPx: grid.lightTexelPx
    readonly property real lightBlocks: grid.lightBlocks

    // Rate-driven motion runs on integrated clocks (SunField.advance) so
    // rates can change without phases jumping.
    property var clocks: null
    onITimeChanged: if (passesEnabled) clocks = SunField.advance(clocks, root)
    readonly property real heightClock: clocks ? clocks.height : 0
    readonly property real tiltClock: clocks ? clocks.tilt : 0
    readonly property real backPaletteClock: clocks ? clocks.backPalette : 0
    readonly property real frontPaletteClock: clocks ? clocks.frontPalette : 0
    readonly property var sunField: passesEnabled && clocks ? SunField.field(root, clocks) : SunField.empty()

    function slot(v) {
        return Qt.vector4d(v[0], v[1], v[2], v[3]);
    }

    // Front-sun placements for the light pass.
    property vector4d frontSun0: slot(sunField.front[0])
    property vector4d frontSun1: slot(sunField.front[1])
    property vector4d frontSun2: slot(sunField.front[2])
    property vector4d frontSun3: slot(sunField.front[3])
    property vector4d frontSun4: slot(sunField.front[4])
    property vector4d frontSun5: slot(sunField.front[5])
    property vector4d frontSun6: slot(sunField.front[6])
    property vector4d frontSun7: slot(sunField.front[7])
    property vector4d frontSun8: slot(sunField.front[8])
    property vector4d frontSun9: slot(sunField.front[9])

    property var cellTex: cellSource
    property var lightTex: lightSource

    // Pre-pass shaders; the dev preview overrides these to hot-reload.
    property url cellShader: Qt.resolvedUrl("../Shaders/qsb/chrome_hexrain_cells.frag.qsb")
    property url lightShader: Qt.resolvedUrl("../Shaders/qsb/chrome_hexrain_light.frag.qsb")

    ShaderEffect {
        id: cellPass
        width: root.gridCols * root.gridCellTexels
        height: root.gridRows
        fragmentShader: root.cellShader
        property real iTime: root.iTime
        property real cellSize: root.cellSize
        property real heightClock: root.heightClock
        property real heightRange: root.heightRange
        property real tiltMax: root.tiltMax
        property real tiltClock: root.tiltClock
        property real flipOriginX: root.flipOriginX
        property real flipOriginY: root.flipOriginY
        property real flipStartTime: root.flipStartTime
        property real flipPropDelay: root.flipPropDelay
        property real flipDuration: root.flipDuration
        property real barZoneEnabled: root.barZoneEnabled
        property real barZoneAnchor: root.barZoneAnchor
        property real barZoneThickness: root.barZoneThickness
        property real barZoneElevation: root.barZoneElevation
        property vector3d iResolution: root.iResolution
        property real hexBevel: root.hexBevel
        property real slabThickness: root.slabThickness
        property real cameraDistance: root.cameraDistance
        property real gridCols: root.gridCols
        property real gridRows: root.gridRows
        property real gridMargin: root.gridMargin
        property real gridCellTexels: root.gridCellTexels
        property vector4d windowGeom: root.windowGeom
    }

    ShaderEffectSource {
        id: cellSource
        sourceItem: root.passesEnabled ? cellPass : null
        hideSource: true
        textureSize: Qt.size(cellPass.width, cellPass.height)
        format: ShaderEffectSource.RGBA32F
        smooth: false
    }

    ShaderEffect {
        id: lightPass
        width: root.lightCols * root.lightBlocks
        height: root.lightRows
        fragmentShader: root.lightShader
        property real iTime: root.iTime
        property real cellSize: root.cellSize
        property real frontSunSize: root.frontSunSize
        property real frontSunHeight: root.frontSunHeight
        property real backSunSize: root.backSunSize
        property real backSunStrength: root.backSunStrength
        property real backNegSunSize: root.backNegSunSize
        property real backNegSunStrength: root.backNegSunStrength
        property real backPaletteClock: root.backPaletteClock
        property real frontPaletteClock: root.frontPaletteClock
        property real backSunCount: root.backSunCount
        property real backNegSunCount: root.backNegSunCount
        property real frontSunCount: root.frontSunCount
        property real frontNegSunCount: root.frontNegSunCount
        property real frontNegSunStrength: root.frontNegSunStrength
        property real frontNegSunSize: root.frontNegSunSize
        property real fastBackSunStrength: root.fastBackSunStrength
        property real fastBackSunSize: root.fastBackSunSize
        property real flipOriginX: root.flipOriginX
        property real flipOriginY: root.flipOriginY
        property real flipStartTime: root.flipStartTime
        property real flipPropDelay: root.flipPropDelay
        property real flipDuration: root.flipDuration
        property real lightCols: root.lightCols
        property real lightRows: root.lightRows
        property real lightTexelPx: root.lightTexelPx
        property vector3d iResolution: root.iResolution
        property vector4d colorPrimary: root.colorPrimary
        property vector4d colorPrimaryNext: root.colorPrimaryNext
        property vector4d colorSecondary: root.colorSecondary
        property vector4d colorSecondaryNext: root.colorSecondaryNext
        property vector4d colorTertiary: root.colorTertiary
        property vector4d colorTertiaryNext: root.colorTertiaryNext

        property vector4d backSun0: root.slot(root.sunField.back[0])
        property vector4d backSun1: root.slot(root.sunField.back[1])
        property vector4d backSun2: root.slot(root.sunField.back[2])
        property vector4d backSun3: root.slot(root.sunField.back[3])
        property vector4d backSun4: root.slot(root.sunField.back[4])
        property vector4d backSun5: root.slot(root.sunField.back[5])
        property vector4d backSun6: root.slot(root.sunField.back[6])
        property vector4d backSun7: root.slot(root.sunField.back[7])
        property vector4d backSun8: root.slot(root.sunField.back[8])
        property vector4d backSun9: root.slot(root.sunField.back[9])
        property vector4d fastBackSun: root.slot(root.sunField.fastBack)
        property vector4d backNegSun0: root.slot(root.sunField.backNeg[0])
        property vector4d backNegSun1: root.slot(root.sunField.backNeg[1])
        property vector4d backNegSun2: root.slot(root.sunField.backNeg[2])
        property vector4d backNegSun3: root.slot(root.sunField.backNeg[3])
        property vector4d backNegSun4: root.slot(root.sunField.backNeg[4])
        property vector4d backNegSun5: root.slot(root.sunField.backNeg[5])
        property vector4d backNegSun6: root.slot(root.sunField.backNeg[6])
        property vector4d backNegSun7: root.slot(root.sunField.backNeg[7])
        property vector4d backNegSun8: root.slot(root.sunField.backNeg[8])
        property vector4d backNegSun9: root.slot(root.sunField.backNeg[9])
        property vector4d frontSun0: root.frontSun0
        property vector4d frontSun1: root.frontSun1
        property vector4d frontSun2: root.frontSun2
        property vector4d frontSun3: root.frontSun3
        property vector4d frontSun4: root.frontSun4
        property vector4d frontSun5: root.frontSun5
        property vector4d frontSun6: root.frontSun6
        property vector4d frontSun7: root.frontSun7
        property vector4d frontSun8: root.frontSun8
        property vector4d frontSun9: root.frontSun9
        property vector4d frontNegSun0: root.slot(root.sunField.frontNeg[0])
        property vector4d frontNegSun1: root.slot(root.sunField.frontNeg[1])
        property vector4d frontNegSun2: root.slot(root.sunField.frontNeg[2])
        property vector4d frontNegSun3: root.slot(root.sunField.frontNeg[3])
        property vector4d frontNegSun4: root.slot(root.sunField.frontNeg[4])
        property vector4d frontNegSun5: root.slot(root.sunField.frontNeg[5])
        property vector4d frontNegSun6: root.slot(root.sunField.frontNeg[6])
        property vector4d frontNegSun7: root.slot(root.sunField.frontNeg[7])
        property vector4d frontNegSun8: root.slot(root.sunField.frontNeg[8])
        property vector4d frontNegSun9: root.slot(root.sunField.frontNeg[9])
    }

    ShaderEffectSource {
        id: lightSource
        sourceItem: root.passesEnabled ? lightPass : null
        hideSource: true
        textureSize: Qt.size(lightPass.width, lightPass.height)
        format: ShaderEffectSource.RGBA16F
        smooth: true
    }
}
