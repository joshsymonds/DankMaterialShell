#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// Cell pass for chrome_hexrain.frag. Everything here depends only on the
// hex cell (plus an edge or a sun), not on the pixel, so it is computed once
// per cell per frame instead of by every fragment that needs it.
//
// Layout: each cell owns gridCellTexels (20) consecutive texels in its row.
// x = (column + gridMargin) * gridCellTexels + j, y = row + gridMargin; the
// margin keeps the neighbours of cells on the canvas edge in range. Columns
// and rows follow the main pass's tiling of the virtual canvas (odd rows
// shifted half a pitch).
//
//   j 0..5    edge bucket j:  rgb = 2D-layer stream activations A/B/C on
//                             that edge (wind-weighted), a = cell height
//   j 6, 7    leak coefficients toward a taller neighbour, k = 0..3 / 4..5:
//             clamp(Δheight * 2.5, 0, 1), or 0 if that neighbour isn't
//             taller (Δ > 0.005)
//   j 8, 9    bleed-back coefficients toward a shorter neighbour, likewise,
//             already scaled by bleedBack
//   j 10..19  front sun j-10's cast shadow onto this cell: xy = shadow
//             centre, z = shadow hex size, w = weight (0 = no shadow)
//
// Neighbour k sits at angle k·60° (distance 2·cellSize). Heights include the
// bar-zone elevation of the output this pass renders for.
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float iTime;
    float cellSize;
    vec3 iResolution;
    float heightDriftSpeed;
    float bleedBack;
    float frontSunSize;
    float frontSunShadowLength;
    float frontSunCount;
    vec4 windowGeom;
    float barZoneEnabled;
    float barZoneAnchor;
    float barZoneThickness;
    float barZoneElevation;
    float gridCols;
    float gridRows;
    float gridMargin;
    float gridCellTexels;
    // Front-sun placements (SunField.js): xy = virtual-canvas position,
    // z = active mask, w = appearance hash.
    vec4 frontSun0; vec4 frontSun1; vec4 frontSun2; vec4 frontSun3; vec4 frontSun4;
    vec4 frontSun5; vec4 frontSun6; vec4 frontSun7; vec4 frontSun8; vec4 frontSun9;
} ubuf;

const float PI3 = 1.04719755;        // π / 3
const float TWO_PI = 6.28318531;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 f = fract(p);
    vec2 i_ = floor(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i_ + vec2(0.0, 0.0)), hash(i_ + vec2(1.0, 0.0)), f.x),
        mix(hash(i_ + vec2(0.0, 1.0)), hash(i_ + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

float fbm(vec2 p) {
    return 0.5 * noise(p) + 0.25 * noise(p * 2.0);
}

// Qt's ShaderEffect can't upload uniform arrays and GLSL ES 100 has no
// switch, so the front-sun slots are read through a plain if-chain.
vec4 frontSunSlot(int s) {
    if (s == 0) return ubuf.frontSun0;
    if (s == 1) return ubuf.frontSun1;
    if (s == 2) return ubuf.frontSun2;
    if (s == 3) return ubuf.frontSun3;
    if (s == 4) return ubuf.frontSun4;
    if (s == 5) return ubuf.frontSun5;
    if (s == 6) return ubuf.frontSun6;
    if (s == 7) return ubuf.frontSun7;
    if (s == 8) return ubuf.frontSun8;
    return ubuf.frontSun9;
}

// Per-hex height field: a static base noise plus a slow per-cell
// oscillation. Each cell gets a unique phase and period (random
// derived from its centre coords) so neighbours never rise/fall
// together — the field "breathes" asynchronously. heightDriftSpeed
// scales the oscillation rate; 0 freezes the field.
float hexHeight(vec2 center, float time) {
    float base = noise(center * 0.005);
    float phase = hash(center * 0.07) * TWO_PI;
    float period = 12.0 + hash(center * 0.07 + vec2(13.7, 27.3)) * 24.0;
    float drift = sin(time * TWO_PI / period * ubuf.heightDriftSpeed + phase) * 0.12;
    return base + drift;
}

// Bar-zone elevation bump for a cell at the given virtual-canvas
// position. The bar is anchored to one of four edges of THIS window
// (not virtual canvas) so each output has its own bar band. Returns
// 0 when the bar is disabled or the cell sits outside the band.
//   anchor 0 = top, 1 = bottom, 2 = left, 3 = right.
float barElevationFor(vec2 worldPos) {
    if (ubuf.barZoneEnabled < 0.5) return 0.0;
    // Map virtual-canvas position back to window-local.
    vec2 local = worldPos - ubuf.windowGeom.xy;
    int anchor = int(ubuf.barZoneAnchor + 0.5);
    // Distance from the anchored edge of this window.
    float distFromEdge;
    if      (anchor == 0) distFromEdge = local.y;                          // top
    else if (anchor == 1) distFromEdge = ubuf.windowGeom.w - local.y;      // bottom
    else if (anchor == 2) distFromEdge = local.x;                          // left
    else                  distFromEdge = ubuf.windowGeom.z - local.x;      // right
    // Bounds check matters for neighbour cells that fall outside this
    // window's pixel rect (e.g. the leftmost bar-zone hex's left
    // neighbour, which sits across the bezel in the next output's
    // territory). Without it, distFromEdge can be negative and would
    // falsely satisfy `< thickness`, elevating cells that don't belong
    // to this output.
    return (distFromEdge >= 0.0 && distFromEdge < ubuf.barZoneThickness)
         ? ubuf.barZoneElevation : 0.0;
}

// Elevation of the cell centred at `center`: height field + bar bump.
float elevation(vec2 center) {
    return hexHeight(center, ubuf.iTime) + barElevationFor(center);
}

// Centre of neighbour k (angle k·60°), snapped onto the lattice so it is
// exactly the centre that cell computes for itself.
vec2 neighbourCenter(vec2 center, float k, float pitchX, float pitchY, float i) {
    float ang = k * PI3;
    vec2 n = center + vec2(cos(ang), sin(ang)) * 2.0 * i;
    float row = floor(n.y / pitchY + 0.5);
    float xOff = mod(row, 2.0) < 0.5 ? 0.0 : pitchX * 0.5;
    return vec2(floor((n.x - xOff) / pitchX + 0.5) * pitchX + xOff, row * pitchY);
}

// Leak (taller neighbour) or bleed-back (shorter neighbour) coefficient
// toward neighbour k.
float leakCoefficient(vec2 center, float current, float k, bool bleed,
                      float pitchX, float pitchY, float i) {
    float n = elevation(neighbourCenter(center, k, pitchX, pitchY, i));
    if (!bleed && n > current + 0.005)
        return clamp((n - current) * 2.5, 0.0, 1.0);
    if (bleed && current > n + 0.005)
        return clamp((current - n) * 2.5, 0.0, 1.0) * ubuf.bleedBack;
    return 0.0;
}

vec4 edgeStreams(vec2 cellCenter, float bucket, float i) {
    float edgeAngle = bucket * PI3;
    vec2 edgeFaceDir = vec2(cos(edgeAngle), sin(edgeAngle));
    vec2 edgeWorld = cellCenter + edgeFaceDir * i;

    // ── Three independent flow streams ─────────────────────────────
    // Each stream is its own noise field drifting at its own velocity,
    // associated with its own color. Edges light up where any stream's
    // field is over its own threshold; multiple overlapping streams
    // sum their colors. Result reads as several "light entities"
    // moving behind the hexes at different speeds and directions, with
    // hexes only revealing where they overlap.
    //
    // Each stream's sample position = (edgeWorld * scale) + circular
    // phase shuffle + linear translation. The phase shuffle is a slow
    // circular drift in noise-space that cycles every ~60-120s with
    // a different frequency per stream, so slow translation doesn't
    // leave blobs hovering over the same edges for tens of seconds.

    // Stream A: slow diagonal down-right, primary (cyan). Big blobs.
    vec2 shuffleA = vec2(sin(ubuf.iTime * 0.07), cos(ubuf.iTime * 0.07)) * 0.30;
    vec2 sA = edgeWorld * 0.02 + shuffleA - vec2(ubuf.iTime * 0.03, ubuf.iTime * 0.022);
    float litA = smoothstep(0.50, 0.66, fbm(sA));

    // Stream B: slow diagonal down-left, secondary (magenta).
    vec2 shuffleB = vec2(sin(ubuf.iTime * 0.09 + 2.1), cos(ubuf.iTime * 0.09 + 2.1)) * 0.25;
    vec2 sB = edgeWorld * 0.04 + shuffleB + vec2(ubuf.iTime * 0.025, -ubuf.iTime * 0.035);
    float litB = smoothstep(0.52, 0.66, fbm(sB));

    // Stream C: slow counter-flow up-left, tertiary (neon green).
    vec2 shuffleC = vec2(sin(ubuf.iTime * 0.06 + 4.3), cos(ubuf.iTime * 0.06 + 4.3)) * 0.30;
    vec2 sC = edgeWorld * 0.04 + shuffleC + vec2(ubuf.iTime * 0.04, ubuf.iTime * 0.04);
    float litC = smoothstep(0.56, 0.72, fbm(sC));

    // ── Wind direction modulation — directional progression ──────
    // A global "wind" angle pendulums between left and right of
    // vertical. Each edge's brightness is boosted by how aligned its
    // facing direction is with the current wind, so light appears to
    // progress across each cell rather than firing all at once.
    float windAngle = 1.5707963 + sin(ubuf.iTime * 0.25) * 1.2566371; // π/2 ± 0.4π
    vec2 windDir = vec2(cos(windAngle), sin(windAngle));
    float windBoost = 0.30 + 0.70 * max(0.0, dot(edgeFaceDir, windDir));

    return vec4(vec3(litA, litB, litC) * windBoost, hexHeight(cellCenter, ubuf.iTime));
}

// Front sun s's cast shadow onto this cell. The caster is a virtual
// point at distance 2i from the cell in the sun's direction — its
// position rotates smoothly with the sun, so there's no 6-neighbour
// rank-swap that would pop the shadow to a different side. Where the
// caster is lit more than the cell, a hex-shaped shadow is thrown
// onto the cell, offset away from the sun and lengthened by the
// lighting difference.
vec4 castShadow(vec2 cellCenter, int s, float i) {
    if (s >= int(ubuf.frontSunCount + 0.5)) return vec4(0.0);
    float canvasMax = max(ubuf.iResolution.x, ubuf.iResolution.y);
    float frontSunSigma = max(ubuf.frontSunSize * canvasMax * 0.5, 1.0);
    float frontInvSig2 = 1.0 / (frontSunSigma * frontSunSigma);

    vec4 place = frontSunSlot(s);
    vec2 sunPos = place.xy;
    vec2 cellToSun = sunPos - cellCenter;
    float cellToSunLen = length(cellToSun);
    if (cellToSunLen <= 0.001) return vec4(0.0);

    float cellR = exp(-dot(cellToSun, cellToSun) * frontInvSig2);
    vec2 sunDir = cellToSun / cellToSunLen;
    vec2 virtualCaster = cellCenter + sunDir * 2.0 * i;
    vec2 vcToSun = sunPos - virtualCaster;
    float vcR = exp(-dot(vcToSun, vcToSun) * frontInvSig2);
    float litDiff = vcR - cellR;
    if (litDiff <= 0.001) return vec4(0.0);

    float diffWeight = smoothstep(0.001, 0.05, litDiff);
    vec2 shadowCenter = cellCenter + sunDir * (i * 1.3);
    float shadowSize = i * (1.2 + litDiff * 2.0 * ubuf.frontSunShadowLength);
    return vec4(shadowCenter, shadowSize,
                diffWeight * clamp(litDiff * 2.5, 0.0, 1.0) * place.z);
}

void main() {
    float i = max(1.0, ubuf.cellSize);
    float pitchX = 2.0 * i;
    float pitchY = 1.7320508 * i;

    vec2 texel = floor(qt_TexCoord0 * vec2(ubuf.gridCols * ubuf.gridCellTexels, ubuf.gridRows));
    float j = mod(texel.x, ubuf.gridCellTexels);
    float col = floor(texel.x / ubuf.gridCellTexels) - ubuf.gridMargin;
    float row = texel.y - ubuf.gridMargin;
    float xOff = mod(row, 2.0) < 0.5 ? 0.0 : pitchX * 0.5;
    vec2 cellCenter = vec2(col * pitchX + xOff, row * pitchY);

    if (j < 5.5) {
        fragColor = edgeStreams(cellCenter, j, i);
        return;
    }
    if (j < 9.5) {
        float current = elevation(cellCenter);
        bool bleed = j > 7.5;
        float k0 = (j < 6.5 || (j > 7.5 && j < 8.5)) ? 0.0 : 4.0;
        fragColor = vec4(
            leakCoefficient(cellCenter, current, k0, bleed, pitchX, pitchY, i),
            leakCoefficient(cellCenter, current, k0 + 1.0, bleed, pitchX, pitchY, i),
            k0 < 0.5 ? leakCoefficient(cellCenter, current, 2.0, bleed, pitchX, pitchY, i) : 0.0,
            k0 < 0.5 ? leakCoefficient(cellCenter, current, 3.0, bleed, pitchX, pitchY, i) : 0.0);
        return;
    }
    fragColor = castShadow(cellCenter, int(j - 10.0 + 0.5), i);
}
