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

// Iquilezles regular-hexagon SDF. `i` is INRADIUS — distance to flat
// edge midpoint, NOT to vertex. Flat-top oriented (horizontal edges
// at y = ±i). Use sdHexagon(p.yx, i) for pointy-top via 90° rotation.
float sdHexagon(vec2 p, float i) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * i, k.z * i), i);
    return length(p) * sign(p.y);
}

// Cheap 2D hash; sufficient for visual noise.
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// 2D value noise via bilinear interpolation between 4 hashed corners.
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

// 2-octave fBm — cheap. Range ~[0, 0.75], mean near 0.4.
float fbm(vec2 p) {
    return 0.5 * noise(p) + 0.25 * noise(p * 2.0);
}

void main() {
    vec2 px = qt_TexCoord0 * ubuf.iResolution.xy;
    float i = max(1.0, ubuf.cellSize);

    // ── Hex tiling — pointy-top, inradius units ────────────────────
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

    float distToEdge = sdHexagon(local.yx, i);

    // ── Flow field — drives "what's lit right now" ─────────────────
    // Sampled at pixel position with downward drift over time. 2D
    // spatial variation in the noise field naturally produces
    // branching / merging zones as the field translates downward.
    vec2 flowSample = vec2(px.x * 0.025, px.y * 0.025 - ubuf.iTime * 0.4);
    float flow = fbm(flowSample);
    float lit = smoothstep(0.42, 0.62, flow);

    // ── Hue field — independent scale + drift rate so color shifts
    // aren't synced to flow brightness. Different bands of the bar
    // can be lit in different colors at the same time.
    vec2 hueSample = vec2(px.x * 0.015 + ubuf.iTime * 0.05, px.y * 0.012 - ubuf.iTime * 0.18);
    float hueN = fbm(hueSample);

    // 3-color blend: primary <-> secondary based on hue noise, plus
    // a kick toward tertiary at the highest lit values.
    vec3 hotCol = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, smoothstep(0.3, 0.7, hueN));
    float tertKick = smoothstep(0.7, 0.95, lit);
    hotCol = mix(hotCol, ubuf.colorTertiary.rgb, tertKick * 0.7);

    // ── Composition ────────────────────────────────────────────────
    // Sharp dim baseline always visible; wide bright glow added where
    // flow is lit. Two-layer composition gives "dark outlines that
    // illuminate when light flows through" rather than "always-bright
    // grid that pulses brighter".
    float baseGlow = exp(-abs(distToEdge) * 0.4);
    float litGlow  = exp(-abs(distToEdge) * 0.15);

    float final = baseGlow * 0.18 + litGlow * lit;

    // Color: faint base in primary container hue, hot color where lit
    vec3 col = mix(ubuf.colorPrimary.rgb, hotCol, lit);

    float a_out = clamp(ubuf.intensity * final, 0.0, 1.0) * ubuf.qt_Opacity;
    fragColor = vec4(col * a_out, a_out);
}
