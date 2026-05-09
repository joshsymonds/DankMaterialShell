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

    float distToEdge = sdHexagon(local.yx, i);

    // ── Identify the nearest EDGE midpoint ─────────────────────────
    // For pointy-top hex, edge midpoints are at angles 0°, 60°, 120°,
    // 180°, 240°, 300° from cell center, at distance = inradius. Snap
    // the fragment's angle into 60° buckets to find which edge it
    // belongs to. Sampling the flow field at the edge MIDPOINT (not
    // the fragment position) means the whole sector covering one edge
    // gets the same flow value — so individual edges activate as
    // distinct units rather than the whole cell pulsing together.
    // Shared edges between adjacent cells map to the same world-space
    // midpoint and therefore the same flow sample → light continuity.
    float angle = atan(local.y, local.x);
    if (angle < 0.0) angle += TWO_PI;
    float bucket = floor(angle / PI3 + 0.5);
    float edgeAngle = bucket * PI3;
    vec2 edgeOffset = vec2(cos(edgeAngle), sin(edgeAngle)) * i;
    vec2 edgeWorld = cellCenter + edgeOffset;

    // ── Flow field — sampled at the edge, not the fragment ────────
    // Drift in pixel-units per second downward (negative y in flow
    // sample = upward in noise = appearing-from-bottom in screen).
    vec2 flowSample = vec2(edgeWorld.x * 0.025, edgeWorld.y * 0.025 - ubuf.iTime * 0.4);
    float flow = fbm(flowSample);
    float lit = smoothstep(0.42, 0.62, flow);

    // ── Hue field — independent scale + drift, biased toward magenta
    // Window 0.25..0.45 shifts the primary↔secondary mix so secondary
    // (magenta) dominates more of the bar over time. Mean of 2-octave
    // fBm sits near 0.4, so most fragments are toward the magenta end
    // of the smoothstep.
    vec2 hueSample = vec2(edgeWorld.x * 0.015 + ubuf.iTime * 0.05, edgeWorld.y * 0.012 - ubuf.iTime * 0.18);
    float hueN = fbm(hueSample);

    vec3 hotCol = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, smoothstep(0.25, 0.45, hueN));
    // Tertiary kick reduced from 0.7 to 0.4 mix — green peaks remain
    // visible at the brightest moments but don't dominate magenta.
    float tertKick = smoothstep(0.75, 0.95, lit);
    hotCol = mix(hotCol, ubuf.colorTertiary.rgb, tertKick * 0.4);

    // ── Composition ────────────────────────────────────────────────
    float baseGlow = exp(-abs(distToEdge) * 0.4);
    float litGlow  = exp(-abs(distToEdge) * 0.15);
    float final = baseGlow * 0.18 + litGlow * lit;

    vec3 col = mix(ubuf.colorPrimary.rgb, hotCol, lit);

    float a_out = clamp(ubuf.intensity * final, 0.0, 1.0) * ubuf.qt_Opacity;
    fragColor = vec4(col * a_out, a_out);
}
