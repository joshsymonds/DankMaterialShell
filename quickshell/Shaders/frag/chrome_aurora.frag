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
    vec4 colorPrimaryContainer;
} ubuf;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

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

    // Veil density field: broad horizontal bands (uv.x * 1.0 = no horizontal
    // cycling, the bar's full width is one continuous zone), more cycles in y
    // (2.5) so several bands are visible at once, drifting upward (-iTime).
    vec2 pv = vec2(uv.x * 1.0, uv.y * 2.5 - ubuf.iTime * 0.15);
    float f = fbm(pv);

    // Hue-pick field: independent noise driving which of three theme colors
    // dominates a given band. Different scale and drift rate from veil so the
    // color of a band shifts independently of its brightness — what makes
    // real aurora look chromatic, not just bright/dim.
    vec2 ph = vec2(uv.x * 1.5 + ubuf.iTime * 0.04, uv.y * 1.0 - ubuf.iTime * 0.08);
    float h = fbm(ph);

    // Soft veil edges — wide smoothstep window for diffuse, hazy transitions.
    float veil = smoothstep(0.15, 0.85, f);

    // Three-color blend: primaryContainer is the muted base, primary and
    // secondary alternate as the "hot" color in veils based on hue noise.
    vec3 hotCol = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, smoothstep(0.3, 0.7, h));
    vec3 col = mix(ubuf.colorPrimaryContainer.rgb, hotCol, veil);

    // Wider alpha range — 0.15 in dark zones lets the BackgroundEffect blur
    // dominate, 0.85 in veil cores makes the shader chromaticity stand out.
    float a = ubuf.intensity * (0.15 + 0.7 * veil) * ubuf.qt_Opacity;

    fragColor = vec4(col * a, a);
}
