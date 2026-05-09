#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float iTime;
    float intensity;
    vec3 iResolution;
    vec4 colorPrimary;
    vec4 colorSecondary;
} ubuf;

// Cheap 2D hash. Sufficient for visual noise; not cryptographic.
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// 2D value noise: bilinear interpolation between four hashed corners,
// smoothstep on f to soften the lattice edges.
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

// fBm: 3 octaves of value noise, halving amplitude each octave.
// Range ~[0, 0.875], mean near 0.44.
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = qt_TexCoord0;

    // Sample noise stretched horizontally (uv.x * 4 = thin vertical veils
    // across a narrow bar) and slowly drifting upward (subtract iTime).
    // Period ratios chosen for tall vertical structure.
    vec2 p = vec2(uv.x * 4.0, uv.y * 1.2 - ubuf.iTime * 0.06);

    float f = fbm(p);

    // Sharpen into distinct veils. Threshold pair brackets the fBm mean
    // so both bright and dark zones see meaningful coverage.
    float veil = smoothstep(0.32, 0.72, f);

    // Color cycles between primary (dark zones) and secondary (veil cores).
    vec3 col = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, veil);

    // Alpha modulation: 0.25 in dark zones (blur dominates), up to 0.80
    // in bright veils (shader dominates). This is what produces visible
    // motion even when primary ≈ secondary perceptually — the *texture*
    // itself drifts, independent of color contrast.
    float a = ubuf.intensity * (0.25 + 0.55 * veil) * ubuf.qt_Opacity;

    fragColor = vec4(col * a, a);
}
