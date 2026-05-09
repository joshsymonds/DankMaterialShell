#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float iTime;
    float intensity;
    float cellSize;
    vec3 iResolution;
    vec4 colorPrimary;
    vec4 colorSecondary;
    vec4 colorPrimaryContainer;
    vec4 colorTertiary;
} ubuf;

const float PI3 = 1.04719755;        // π / 3
const float TWO_PI = 6.28318531;
const float SQRT3_INV = 0.57735027;  // 1 / √3

float sdHexagon(vec2 p, float i) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * i, k.z * i), i);
    return length(p) * sign(p.y);
}

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

void main() {
    vec2 px = qt_TexCoord0 * ubuf.iResolution.xy;
    float i = max(1.0, ubuf.cellSize);

    // ── Hex tiling ─────────────────────────────────────────────────
    float pitchX = 2.0 * i;
    float pitchY = 1.7320508 * i;

    float row0 = floor(px.y / pitchY);
    float row1 = row0 + 1.0;
    float xOff0 = mod(row0, 2.0) < 0.5 ? 0.0 : pitchX * 0.5;
    float xOff1 = mod(row1, 2.0) < 0.5 ? 0.0 : pitchX * 0.5;
    float col0 = floor((px.x - xOff0) / pitchX + 0.5);
    float col1 = floor((px.x - xOff1) / pitchX + 0.5);
    vec2 c0 = vec2(col0 * pitchX + xOff0, row0 * pitchY);
    vec2 c1 = vec2(col1 * pitchX + xOff1, row1 * pitchY);
    vec2 d0 = px - c0;
    vec2 d1 = px - c1;
    vec2 local = (dot(d0, d0) < dot(d1, d1)) ? d0 : d1;
    vec2 cellCenter = px - local;

    // ── Edge identification ────────────────────────────────────────
    // Snap fragment angle to one of 6 edge buckets (every 60°).
    float angle = atan(local.y, local.x);
    if (angle < 0.0) angle += TWO_PI;
    float bucket = floor(angle / PI3 + 0.5);
    float edgeAngle = bucket * PI3;
    vec2 edgeMid = vec2(cos(edgeAngle), sin(edgeAngle)) * i;
    vec2 edgeWorld = cellCenter + edgeMid;

    // Edge axis: 90° rotation of midpoint direction → along the edge.
    vec2 edgeAxis = vec2(-sin(edgeAngle), cos(edgeAngle));
    // Position along the edge (signed). Edge length for pointy-top
    // hex with inradius i is 2*i/√3, so alongEdge ∈ [-i/√3, i/√3].
    float alongEdge = dot(local - edgeMid, edgeAxis);
    float halfEdgeLen = i * SQRT3_INV;

    // ── Active state — flow noise at the edge midpoint, hard threshold
    // Each edge fires independently based on a slow drifting noise
    // field. Sharp smoothstep window makes activation feel discrete
    // rather than a smooth gradient — the game-of-life on/off cue.
    vec2 flowSample = vec2(edgeWorld.x * 0.04, edgeWorld.y * 0.04 - ubuf.iTime * 0.25);
    float flow = fbm(flowSample);
    float firing = smoothstep(0.48, 0.56, flow);

    // ── Comet along the firing edge ────────────────────────────────
    // Light source travels back-and-forth along the edge. Per-edge
    // phase from a hash of the edge's discrete world position so
    // adjacent edges have unrelated motion phases.
    float edgePhase = hash(floor(edgeWorld * 0.5));
    float t = ubuf.iTime * 1.5 + edgePhase * TWO_PI;
    float cometX = sin(t) * halfEdgeLen;
    float comet = exp(-abs(alongEdge - cometX) * 4.0);

    float lit = firing * comet;

    // ── Distance to edge — for the glow falloff perpendicular to it
    float distToEdge = sdHexagon(local.yx, i);

    // Sharper falloff than before so lit zones stay near the edge,
    // not bleeding inward to fill the cell sector. 0.6 decay means
    // meaningful brightness extends ~3px from the seam.
    float litGlow = exp(-abs(distToEdge) * 0.6) * lit;
    // Faint always-on outline, sharper still so even the base hex
    // network reads as outlines, not glow halos.
    float baseOutline = exp(-abs(distToEdge) * 0.9);

    // ── Hue ─────────────────────────────────────────────────────────
    vec2 hueSample = vec2(edgeWorld.x * 0.015 + ubuf.iTime * 0.05, edgeWorld.y * 0.012 - ubuf.iTime * 0.18);
    float hueN = fbm(hueSample);
    vec3 hotCol = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, smoothstep(0.25, 0.45, hueN));
    float tertKick = smoothstep(0.6, 0.95, lit);
    hotCol = mix(hotCol, ubuf.colorTertiary.rgb, tertKick * 0.4);

    // ── Layered composition (premultiplied) ────────────────────────
    // Three independent layers sum into the final color/alpha:
    //   interior — constant deep purple, fills the whole bar uniformly
    //   outline  — thin faint cyan tracing every hex edge (always on)
    //   lit      — bright hot color where flow + comet intersect
    // Each layer contributes both color and alpha; the output is
    // their sum, clamped at 1.0 for the alpha. Color stays additive
    // so peak brightness can pop against the constant interior.
    float interiorAlpha = 0.55;
    float outlineAlpha = baseOutline * 0.18;
    float litAlpha = litGlow;

    vec3 finalColor =
        ubuf.colorPrimaryContainer.rgb * interiorAlpha
      + ubuf.colorPrimary.rgb * outlineAlpha
      + hotCol * litAlpha;

    float a = clamp(interiorAlpha + outlineAlpha + litAlpha, 0.0, 1.0);

    fragColor = vec4(finalColor * ubuf.intensity * ubuf.qt_Opacity,
                     a * ubuf.intensity * ubuf.qt_Opacity);
}
