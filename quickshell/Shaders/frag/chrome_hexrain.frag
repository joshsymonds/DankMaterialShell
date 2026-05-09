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

// Regular hexagon SDF (pointy-top). Quilez technique:
// https://iquilezles.org/articles/distfunctions2d/
// Returns negative inside, positive outside, ~zero on the edge.
float sdHexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}

void main() {
    vec2 px = qt_TexCoord0 * ubuf.iResolution.xy;

    // Pointy-top hex tiling. Horizontal pitch = sqrt(3) * r,
    // vertical pitch = 1.5 * r. Even rows aligned, odd rows
    // offset by half a horizontal pitch.
    float r = max(1.0, ubuf.cellSize);
    vec2 pitch = vec2(1.7320508 * r, 1.5 * r);

    // Two candidate cell centers: even-row lattice and odd-row lattice
    // (offset by half pitch in x). Whichever is closer to this fragment
    // is its actual hex cell.
    vec2 a = mod(px, pitch) - 0.5 * pitch;
    vec2 b = mod(px - 0.5 * pitch, pitch) - 0.5 * pitch;
    vec2 local = (dot(a, a) < dot(b, b)) ? a : b;

    // Distance from this fragment to the nearest hex edge.
    float distToEdge = sdHexagon(local, r);

    // Edge glow: bright at the seam, fades into both interior
    // and exterior. 0.5 multiplier produces ~4-5px glow at r=14.
    float edgeGlow = exp(-abs(distToEdge) * 0.5);

    // Static spike: single color, single uniform-driven intensity.
    // Animation, color cycling, drop-head pops all live in follow-up.
    vec3 col = ubuf.colorPrimary.rgb;
    float a_out = ubuf.intensity * edgeGlow * ubuf.qt_Opacity;
    fragColor = vec4(col * a_out, a_out);
}
