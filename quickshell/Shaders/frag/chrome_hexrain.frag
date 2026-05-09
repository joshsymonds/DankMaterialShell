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

// Iquilezles regular-hexagon SDF. Param `i` is INRADIUS — the distance
// from center to a flat edge midpoint (NOT to a vertex). Hex is
// flat-top-oriented (horizontal flat edges at y = ±i). For pointy-top
// orientation, swap (x, y) before calling: sdHexagon(local.yx, i).
float sdHexagon(vec2 p, float i) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * i, k.z * i), i);
    return length(p) * sign(p.y);
}

void main() {
    vec2 px = qt_TexCoord0 * ubuf.iResolution.xy;
    float i = max(1.0, ubuf.cellSize);  // inradius

    // Pointy-top hex tiling, in inradius units:
    //   horizontal pitch (between adjacent cells in same row) = 2*i
    //   vertical pitch (between rows)                          = sqrt(3)*i
    //   alternating rows offset in x by half pitch
    float pitchX = 2.0 * i;
    float pitchY = 1.7320508 * i;

    // Two candidate ROWS — fragment near a row boundary could belong to
    // either, so we test both and pick the closer center.
    int row0 = int(floor(px.y / pitchY));
    int row1 = row0 + 1;

    // Per-row x-offset alternates: even rows aligned, odd rows shifted.
    float xOff0 = ((row0 & 1) == 0) ? 0.0 : pitchX * 0.5;
    float xOff1 = ((row1 & 1) == 0) ? 0.0 : pitchX * 0.5;

    // Within each candidate row, find the nearest column center.
    int col0 = int(floor((px.x - xOff0) / pitchX + 0.5));
    int col1 = int(floor((px.x - xOff1) / pitchX + 0.5));

    vec2 c0 = vec2(float(col0) * pitchX + xOff0, float(row0) * pitchY);
    vec2 c1 = vec2(float(col1) * pitchX + xOff1, float(row1) * pitchY);

    vec2 d0 = px - c0;
    vec2 d1 = px - c1;

    // Pick the nearer center; `local` is fragment position relative to it.
    vec2 local = (dot(d0, d0) < dot(d1, d1)) ? d0 : d1;

    // Pointy-top SDF via x/y swap of the flat-top formula.
    float distToEdge = sdHexagon(local.yx, i);

    // Wide edge glow — decay 0.15 means meaningful brightness extends
    // ~6-7px from the seam. Combined with intensity 1.0 this produces
    // visible glowing hex outlines instead of hairline-thin lines.
    float edgeGlow = exp(-abs(distToEdge) * 0.15);

    vec3 col = ubuf.colorPrimary.rgb;
    float a_out = clamp(ubuf.intensity * edgeGlow, 0.0, 1.0) * ubuf.qt_Opacity;
    fragColor = vec4(col * a_out, a_out);
}
