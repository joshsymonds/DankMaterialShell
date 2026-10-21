#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// Cell pass for chrome_hexrain.frag. Everything here depends only on the
// hex cell (and an edge), not on the pixel, so it is computed once per cell
// per frame instead of by every fragment that needs it.
//
// Layout: each cell owns gridCellTexels (11) consecutive texels in its row.
// x = (column + gridMargin) * gridCellTexels + j, y = row + gridMargin; the
// margin keeps the neighbours of cells on the canvas edge in range. Columns
// and rows follow the main pass's tiling of the virtual canvas (odd rows
// shifted half a pitch).
//
//   j 0..5    edge bucket j:  rgb = 2D-layer stream activations A/B/C on
//                             that edge (wind-weighted), a = cell height (px)
//   j 6, 7    xy (and zw of j 6): height of neighbour k minus this
//             scale's (px, signed), k = 0..3 / 4..5; zw of j 7: reach of
//             neighbours 4, 5 (as j 10)
//   j 8       the scale's orientation: unit quaternion (xyz, w) taking
//             scale-local vectors to world (flip, then tilt)
//   j 9       the scale's pose: x = height of its centre above the canvas
//             plane (px), y = flip angle (0..π), zw = flip axis (unit, in
//             plane)
//   j 10      reach of neighbours 0..3: how far (px) neighbour k's scale,
//             grown by the main pass's antialiasing margin, can cover
//             pixels on this side of the edge they share, measured inward
//             from that edge (≤ 0 when it stays on its own side)
//
// Neighbour k sits at angle k·60° (distance 2·cellSize). Heights include the
// bar-zone elevation of the output this pass renders for.
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float iTime;
    float cellSize;
    float heightClock;     // ∫ heightDriftSpeed dt (SunField.advance)
    float heightRange;
    float tiltMax;
    float tiltClock;       // ∫ tiltDriftSpeed dt
    float flipOriginX;
    float flipOriginY;
    float flipStartTime;
    float flipPropDelay;
    float flipDuration;
    vec4 windowGeom;
    float barZoneEnabled;
    float barZoneAnchor;
    float barZoneThickness;
    float barZoneElevation;
    // Main-pass geometry, for the neighbour reach (j 10).
    vec3 iResolution;
    float hexBevel;
    float slabThickness;
    float cameraDistance;
    float gridCols;
    float gridRows;
    float gridMargin;
    float gridCellTexels;
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


// Scale height in [-1, 1] (× heightRange px): a broad spatial swell
// plus each scale's own slow bob. Every cell gets a unique phase and
// period (12-36 s, random from its centre) so neighbours never rise
// or fall together and drift above and below each other over time.
// The bob runs on heightClock, so heightDriftSpeed sets its rate (0
// freezes it) and can change without the field jumping.
float scaleHeight(vec2 center) {
    float swell = noise(center * 0.005) * 2.0 - 1.0;
    float phase = hash(center * 0.07) * TWO_PI;
    float period = 12.0 + hash(center * 0.07 + vec2(13.7, 27.3)) * 24.0;
    float bob = sin(ubuf.heightClock * TWO_PI / period + phase);
    return clamp(0.35 * swell + 0.65 * bob, -1.0, 1.0);
}

// Scale tilt: the direction (and amount, ≤ tiltMax radians) its normal
// leans, each component drifting on its own per-scale period
// (18-48 s) on tiltClock (rate tiltDriftSpeed).
vec2 scaleTilt(vec2 center) {
    vec2 phase = vec2(hash(center * 0.11 + vec2(3.1, 7.7)),
                      hash(center * 0.13 + vec2(9.2, 1.4))) * TWO_PI;
    vec2 period = 18.0 + vec2(hash(center * 0.17 + vec2(5.5, 2.2)),
                              hash(center * 0.19 + vec2(8.8, 4.4))) * 30.0;
    vec2 lean = sin(ubuf.tiltClock * TWO_PI / period + phase);
    return lean * 0.70710678 * ubuf.tiltMax;
}

// Flip-wave phase of the cell at `center` (0 → 1 over flipDuration once
// the wave reaches it; hex steps from the origin delay the start).
float cellFlipPhase(vec2 center, float pitchY) {
    float steps = distance(center, vec2(ubuf.flipOriginX, ubuf.flipOriginY)) / max(pitchY, 1.0);
    return clamp((ubuf.iTime - ubuf.flipStartTime - steps * ubuf.flipPropDelay)
                 / max(ubuf.flipDuration, 0.001), 0.0, 1.0);
}

vec4 axisAngle(vec3 axis, float angle) {
    return vec4(axis * sin(angle * 0.5), cos(angle * 0.5));
}

vec4 quatMul(vec4 a, vec4 b) {
    return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz),
                a.w * b.w - dot(a.xyz, b.xyz));
}

vec3 rotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// Flip axis: in-plane, roughly perpendicular to the direction from the
// wave origin so scales tip over away from it like dominoes, snapped to
// the nearest of the hexagon's symmetry lines (every 30°). A half-turn
// about any other line mirrors the hexagon into a rotated copy of
// itself that no longer lines up with its neighbours; about a symmetry
// line it lands exactly on its own outline.
vec2 flipAxis(vec2 center) {
    vec2 out_ = center - vec2(ubuf.flipOriginX, ubuf.flipOriginY);
    if (length(out_) < 0.001) return vec2(1.0, 0.0);
    float stride = PI3 * 0.5;
    float angle = floor(atan(out_.x, -out_.y) / stride + 0.5) * stride;
    return vec2(cos(angle), sin(angle));
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


// Centre of neighbour k (angle k·60°), snapped onto the lattice so it is
// exactly the centre that cell computes for itself.
vec2 neighbourCenter(vec2 center, float k, float pitchX, float pitchY, float i) {
    float ang = k * PI3;
    vec2 n = center + vec2(cos(ang), sin(ang)) * 2.0 * i;
    float row = floor(n.y / pitchY + 0.5);
    float xOff = mod(row, 2.0) < 0.5 ? 0.0 : pitchX * 0.5;
    return vec2(floor((n.x - xOff) / pitchX + 0.5) * pitchX + xOff, row * pitchY);
}

// Height of the scale centred at `center` above the canvas plane (px):
// its height field value plus the bar-zone bump.
float heightPx(vec2 center) {
    return (scaleHeight(center) + barElevationFor(center)) * ubuf.heightRange;
}

// Orientation of the scale centred at `center`: its flip, then its tilt.
vec4 scaleOrientation(vec2 center, float pitchY) {
    float flip = 3.14159265 * smoothstep(0.0, 1.0, cellFlipPhase(center, pitchY));
    vec2 tilt = scaleTilt(center);
    float lean = length(tilt);
    vec4 qTilt = lean > 1e-5 ? axisAngle(vec3(-tilt.y, tilt.x, 0.0) / lean, lean)
                             : vec4(0.0, 0.0, 0.0, 1.0);
    return quatMul(qTilt, axisAngle(vec3(flipAxis(center), 0.0), flip));
}

// Reach of neighbour k into the cell centred at `center` (layout j 10).
// The main pass casts its rays from the camera through each pixel's
// point on the canvas plane, so a scale can only be hit at pixels inside
// its silhouette projected from the camera onto that plane: the hull of
// its twelve slab corners (inradius grown by the main pass's AA_PX, 0.75)
// projected there. Its reach is how far that hull extends past the
// shared edge, plus half a px for rounding.
float neighbourReach(vec2 center, float k, float pitchX, float pitchY, float i) {
    vec2 c = neighbourCenter(center, k, pitchX, pitchY, i);
    vec4 q = scaleOrientation(c, pitchY);
    vec3 lift = vec3(c, heightPx(c));
    float seamWidth = max(0.1, ubuf.hexBevel * i * 0.04);
    float corner = (i - seamWidth + 0.75) * 1.1547005;   // inradius / cos 30°
    float halfT = max(ubuf.slabThickness, 0.1) * 0.5;
    float camDist = max(ubuf.cameraDistance, 100.0);
    vec2 eye = ubuf.iResolution.xy * 0.5;
    vec2 n = vec2(cos(k * PI3), sin(k * PI3));
    vec3 ex = rotate(q, vec3(1.0, 0.0, 0.0));
    vec3 ey = rotate(q, vec3(0.0, 1.0, 0.0));
    vec3 ez = rotate(q, vec3(0.0, 0.0, 1.0)) * halfT;
    float nearest = 1e9;
    for (int v = 0; v < 6; v++) {
        float ang = (float(v) + 0.5) * PI3;
        vec3 rim = lift + (ex * cos(ang) + ey * sin(ang)) * corner;
        for (int f = -1; f <= 1; f += 2) {
            vec3 w = rim + ez * float(f);
            vec2 onPlane = eye + (w.xy - eye) * camDist / max(camDist - w.z, 1.0);
            nearest = min(nearest, dot(onPlane - center, n));
        }
    }
    return i - nearest + 0.5;
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

    return vec4(vec3(litA, litB, litC) * windBoost, heightPx(cellCenter));
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
    if (j > 9.5) {
        fragColor = vec4(neighbourReach(cellCenter, 0.0, pitchX, pitchY, i),
                         neighbourReach(cellCenter, 1.0, pitchX, pitchY, i),
                         neighbourReach(cellCenter, 2.0, pitchX, pitchY, i),
                         neighbourReach(cellCenter, 3.0, pitchX, pitchY, i));
        return;
    }
    if (j > 8.5) {
        float flip = 3.14159265 * smoothstep(0.0, 1.0, cellFlipPhase(cellCenter, pitchY));
        fragColor = vec4(heightPx(cellCenter), flip, flipAxis(cellCenter));
        return;
    }
    if (j > 7.5) {
        fragColor = scaleOrientation(cellCenter, pitchY);
        return;
    }
    // j 6, 7: signed height differences to the neighbours (and j 7 the
    // reach of neighbours 4, 5).
    float own = heightPx(cellCenter);
    if (j < 6.5) {
        fragColor = vec4(
            heightPx(neighbourCenter(cellCenter, 0.0, pitchX, pitchY, i)) - own,
            heightPx(neighbourCenter(cellCenter, 1.0, pitchX, pitchY, i)) - own,
            heightPx(neighbourCenter(cellCenter, 2.0, pitchX, pitchY, i)) - own,
            heightPx(neighbourCenter(cellCenter, 3.0, pitchX, pitchY, i)) - own);
    } else {
        fragColor = vec4(
            heightPx(neighbourCenter(cellCenter, 4.0, pitchX, pitchY, i)) - own,
            heightPx(neighbourCenter(cellCenter, 5.0, pitchX, pitchY, i)) - own,
            neighbourReach(cellCenter, 4.0, pitchX, pitchY, i),
            neighbourReach(cellCenter, 5.0, pitchX, pitchY, i));
    }
}
