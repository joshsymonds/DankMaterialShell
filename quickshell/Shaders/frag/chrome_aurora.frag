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
    vec4 colorTertiary;
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

    // Bright-inclusion highlight: only the hottest ~14% of veil zones
    // produce visible peaks. smoothstep window pushed near the top of the
    // noise range so highlights are rare and localized — what makes real
    // aurora chromatic, not just bright/dim. Squared to bias even more
    // sharply toward the absolute peaks.
    float highlight = smoothstep(0.78, 0.92, f);
    highlight *= highlight;

    // Three-color blend: primaryContainer is the muted base, primary and
    // secondary alternate as the "hot" color in veils based on hue noise.
    vec3 hotCol = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, smoothstep(0.3, 0.7, h));
    vec3 col = mix(ubuf.colorPrimaryContainer.rgb, hotCol, veil);

    // Inject Theme.tertiary at highlight peaks. Tertiary is matugen's
    // hue-shifted complementary accent to primary (M3 spec) — gives the
    // visible chromatic pop the user asked for while staying inside the
    // matugen-derived palette so the bar doesn't visually clash.
    col = mix(col, ubuf.colorTertiary.rgb, highlight * 0.85);

    // Alpha range 0.15..0.85 baseline, plus an additive boost at highlights
    // (capped at 1.0 implicitly by the framebuffer) so peaks read opaque
    // and punchy rather than muted-translucent.
    float a = ubuf.intensity * (0.15 + 0.7 * veil + 0.4 * highlight) * ubuf.qt_Opacity;
    a = clamp(a, 0.0, 1.0);

    fragColor = vec4(col * a, a);
}
