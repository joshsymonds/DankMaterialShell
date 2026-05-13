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

void main() {
    float t = 0.5 + 0.5 * sin(ubuf.iTime);
    vec3 rgb = mix(ubuf.colorPrimary.rgb, ubuf.colorSecondary.rgb, t);
    float a = ubuf.intensity * ubuf.qt_Opacity;
    fragColor = vec4(rgb * a, a);
}
