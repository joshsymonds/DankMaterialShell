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
    // Alt mode: 2D point-light "suns" drift behind the hex grid; each
    // hex is shaded by sun colour through one of two sub-mode masks.
    // modeAmount=0 → original 2D matrix-rain bar look. modeAmount=1 →
    // alt mode active, with subModeAmount selecting between:
    //   subModeAmount=0 → "lattice" — bright dome at each hex centre,
    //                     dim seams between (looks like glowing lattice
    //                     points behind a dark mesh)
    //   subModeAmount=1 → "scales" — dim hex bodies with a uniformly-
    //                     thin bright rim along every hex side (each
    //                     hex reads as a discrete scale, seams between
    //                     them are bright thin lines)
    float modeAmount;
    float subModeAmount;   // 0 = lattice, 1 = scales (continuous blend)
    float domeStrength;    // 0..1 — multiplier on lit-zone intensity
    float seamGlow;        // 0..3 — multiplier on the lit portion
    float sunDriftSpeed;   // 0..3 — sun-position drift rate multiplier
    float heightAmount;    // 0..1 — strength of the neighbour-height
                           //         leak effect overall.
    float matteness;       // 0..1 — surface "light friction". Low =
                           //         light travels far across the top;
                           //         high = light absorbed quickly.
    float bleedBack;       // 0..1 — small bleed of light onto the
                           //         taller hex's own edge (very subtle).
    float hexBevel;        // 0..1 — strength of the constant darker
                           //         rim band on every hex (the "inset"
                           //         shadow that makes each hex read as
                           //         a raised face). Same width on every
                           //         hex; doesn't vary with height.
    float heightDriftSpeed; // 0..3 — rate at which per-hex heights
                            //         drift up/down over time. 0 =
                            //         static field (heights frozen at
                            //         their base noise value); 1 = each
                            //         hex completes a full lower/raise
                            //         cycle every 12-36 seconds (random
                            //         per hex so they don't pulse in
                            //         lockstep); >1 = faster.
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

// Per-hex height field: a static base noise plus a slow per-cell
// oscillation. Each cell gets a unique phase and period (random
// derived from its centre coords) so neighbours never rise/fall
// together — the field "breathes" asynchronously. heightDriftSpeed
// scales the oscillation rate; 0 freezes the field.
float hexHeight(vec2 center, float time) {
    float base = noise(center * 0.005);
    float phase = hash(center * 0.07) * TWO_PI;
    float period = 12.0 + hash(center * 0.07 + vec2(13.7, 27.3)) * 24.0;
    float drift = sin(time * TWO_PI / period * ubuf.heightDriftSpeed + phase) * 0.12;
    return base + drift;
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

    // ── Three independent flow streams ─────────────────────────────
    // Each stream is its own noise field drifting at its own velocity,
    // associated with its own color. Edges light up where any stream's
    // field is over its own threshold; multiple overlapping streams
    // sum their colors. Result reads as several "light entities"
    // moving behind the hexes at different speeds and directions, with
    // hexes only revealing where they overlap.
    //
    // Velocities are in noise-units per second. Stream-specific scales
    // give different blob sizes so the same velocity reads as visibly
    // different "flow rates."

    // Each stream's sample position = (edgeWorld * scale) + circular
    // phase shuffle + linear translation. The phase shuffle is a slow
    // circular drift in noise-space that cycles every ~60-120s with
    // a different frequency per stream. Without it, slow translation
    // velocities mean blobs hover near the same edges for tens of
    // seconds → user perceives "always the same spots" recurrence.
    // The shuffle keeps the noise values at each edge changing even
    // when the linear translation is slow.

    // Stream A: slow diagonal down-right, primary (cyan). Big blobs.
    vec2 shuffleA = vec2(sin(ubuf.iTime * 0.07), cos(ubuf.iTime * 0.07)) * 0.30;
    vec2 sA = edgeWorld * 0.02 + shuffleA - vec2(ubuf.iTime * 0.03, ubuf.iTime * 0.022);
    float fA = fbm(sA);
    float litA = smoothstep(0.50, 0.66, fA);

    // Stream B: slow diagonal down-left, secondary (magenta).
    vec2 shuffleB = vec2(sin(ubuf.iTime * 0.09 + 2.1), cos(ubuf.iTime * 0.09 + 2.1)) * 0.25;
    vec2 sB = edgeWorld * 0.04 + shuffleB + vec2(ubuf.iTime * 0.025, -ubuf.iTime * 0.035);
    float fB = fbm(sB);
    float litB = smoothstep(0.52, 0.66, fB);

    // Stream C: slow counter-flow up-left, tertiary (neon green).
    vec2 shuffleC = vec2(sin(ubuf.iTime * 0.06 + 4.3), cos(ubuf.iTime * 0.06 + 4.3)) * 0.30;
    vec2 sC = edgeWorld * 0.04 + shuffleC + vec2(ubuf.iTime * 0.04, ubuf.iTime * 0.04);
    float fC = fbm(sC);
    float litC = smoothstep(0.56, 0.72, fC);

    // ── Wind direction modulation — directional progression ──────
    // A global "wind" angle pendulums between left and right of
    // vertical. Each edge's brightness is boosted by how aligned its
    // facing direction is with the current wind. As wind sweeps from
    // left → up → right and back, edges on the windward side of cells
    // light up first, top edges peak when wind is straight up, then
    // edges on the leeward side. Gives the visual sense of light
    // progressing across each cell rather than firing all at once.
    float windAngle = 1.5707963 + sin(ubuf.iTime * 0.25) * 1.2566371; // π/2 ± 0.4π
    vec2 windDir = vec2(cos(windAngle), sin(windAngle));
    vec2 edgeFaceDir = vec2(cos(edgeAngle), sin(edgeAngle));
    float windBoost = 0.30 + 0.70 * max(0.0, dot(edgeFaceDir, windDir));

    litA *= windBoost;
    litB *= windBoost;
    litC *= windBoost;

    // ── Combined activation and color ──────────────────────────────
    // hotCol pre-weights each color by its own lit value so summing
    // gives correctly-weighted blends where streams overlap. lit total
    // is clamped at 1.0 for the alpha channel.
    vec3 hotCol = ubuf.colorPrimary.rgb   * litA
               + ubuf.colorSecondary.rgb * litB
               + ubuf.colorTertiary.rgb  * litC;

    float lit = clamp(litA + litB + litC, 0.0, 1.0);

    // ── Distance to edge — for the glow falloff perpendicular to it
    float distToEdge = sdHexagon(local.yx, i);

    // litGlowRaw is the bare perpendicular-falloff (no `lit` multiplied
    // in) because hotCol is already pre-weighted by per-stream litI
    // values. Multiplying both would double-count.
    float litGlowRaw = exp(-abs(distToEdge) * 0.6);
    // Faint always-on outline, sharper still so the base hex network
    // reads as thin lines, not glow halos.
    float baseOutline = exp(-abs(distToEdge) * 0.9);

    // ── Layered composition (premultiplied) ────────────────────────
    // Three independent layers sum into the final color/alpha:
    //   interior — constant deep purple, fills the whole bar uniformly
    //   outline  — thin faint cyan tracing every hex edge (always on)
    //   lit      — bright hot color on edges currently firing
    // Each layer contributes both color and alpha; the output is
    // their sum, clamped at 1.0 for the alpha. Color stays additive
    // so peak brightness can pop against the constant interior.
    float interiorAlpha = 0.55;
    float outlineAlpha = baseOutline * 0.18;
    // hotCol is the pre-weighted color sum (Σ color_i * lit_i). Total
    // alpha for the lit layer is Σ lit_i scaled by the spatial falloff,
    // = lit * litGlowRaw. Color contribution is hotCol * litGlowRaw —
    // not hotCol * litAlpha, because that would multiply by lit twice.
    float litAlpha = lit * litGlowRaw;

    vec3 finalColor2D =
        ubuf.colorPrimaryContainer.rgb * interiorAlpha
      + ubuf.colorPrimary.rgb * outlineAlpha
      + hotCol * litGlowRaw;

    float alpha2D = clamp(interiorAlpha + outlineAlpha + litAlpha, 0.0, 1.0);

    // ── Scales + suns composition ──────────────────────────────────
    // Mental model: three large soft "suns" drift in screen space behind
    // a foreground grid of hex-shaped scales. Each scale is dim in its
    // centre and bright at its rim, so the suns' colours read through
    // the seams between hexes. With suns at different positions painting
    // primary/secondary/tertiary, every seam picks up whichever sun is
    // nearest behind it — the field looks like coloured light bleeding
    // through stained-glass scales.

    // Three suns on Lissajous-like screen-space paths. Different
    // frequencies per axis stop the loop from repeating obviously;
    // sunDriftSpeed scales the rate so the harness can dial it.
    float t = ubuf.iTime * ubuf.sunDriftSpeed;
    vec2 screenC = ubuf.iResolution.xy * 0.5;
    vec2 screenR = ubuf.iResolution.xy * 0.40;
    vec2 sunPosA = screenC + vec2(cos(t * 0.13       ) * screenR.x,
                                  sin(t * 0.17 + 1.0 ) * screenR.y);
    vec2 sunPosB = screenC + vec2(cos(t * 0.11 + 2.3 ) * screenR.x,
                                  sin(t * 0.19 + 3.7 ) * screenR.y);
    vec2 sunPosC = screenC + vec2(cos(t * 0.17 + 4.5 ) * screenR.x,
                                  sin(t * 0.13 + 0.8 ) * screenR.y);

    // Gaussian falloff. sigma scaled to the larger screen dim so suns
    // span several hex-widths regardless of resolution.
    float sigma = max(ubuf.iResolution.x, ubuf.iResolution.y) * 0.40;
    float invSig2 = 1.0 / (sigma * sigma);
    vec2 dA = px - sunPosA;
    vec2 dB = px - sunPosB;
    vec2 dC = px - sunPosC;
    float gA = exp(-dot(dA, dA) * invSig2);
    float gB = exp(-dot(dB, dB) * invSig2);
    float gC = exp(-dot(dC, dC) * invSig2);

    vec3 lightFromSuns = ubuf.colorPrimary.rgb   * gA
                       + ubuf.colorSecondary.rgb * gB
                       + ubuf.colorTertiary.rgb  * gC;

    // Lattice mask: bright at hex centres, fading toward edges. Uses
    // distNorm (radial position within the hex) so the bright zone has
    // the rotational symmetry of a glowing dome.
    float distNorm = length(local) / i;
    float latticeMask = 1.0 - smoothstep(0.20, 0.98, distNorm);

    // Neighbour-height leak model (inspired by the gnomon wallpaper):
    // each hex is a flat matte-topped column at its own elevation.
    // Light is at "ground level" beneath the field; it bleeds out
    // from underneath each TALLER hex onto the rim of its shorter
    // neighbour. So a hex's top is lit only on the edges where it
    // borders a taller hex — direction and intensity per edge depend
    // on which neighbour is taller and by how much. A hex with no
    // taller neighbours is fully dark; a hex surrounded by taller
    // ones is lit on every side. Per-hex height = noise(cellCenter).

    float currentHeight = hexHeight(cellCenter, ubuf.iTime);

    // Neighbour layout (pointy-top tiling: each hex has 6 neighbours
    // at distance 2i and angles 0°,60°,120°,180°,240°,300°). For the
    // kth neighbour, edge-normal direction is (cos(k·60°), sin(k·60°))
    // and the offset to the neighbour's centre is twice that. We
    // compute these inline in the loop rather than via a const array
    // so the shader stays compatible with GLSL ES 1.0 backends
    // (which Qt RHI may target — const arrays would error there).

    // Seam width: an always-on dark gap between adjacent hexes,
    // representing the visible groove between column tops. hexBevel
    // controls width. Floor at 1 px so it never disappears.
    float seamWidth = max(0.5, ubuf.hexBevel * i * 0.04);

    // Grazing-light model: the suns sit very close to the underside
    // of the matte top, so light spills out from beneath taller
    // neighbours at near-grazing angle. Brightness is peak at the
    // seam itself and decays exponentially as it crosses the matte
    // — matte absorption removes light per unit travel.
    //
    // matteness controls the decay length: 0 = light travels almost
    // the full hex width before fading; 1 = light dies within a
    // pixel or two of the seam. Peak intensity scales with the
    // height differential — bigger steps expose more underside, so
    // more light spills out.
    //
    // SUM (not max) over the 6 neighbours so that when several edges
    // light up at once, their exponential tails add up — a hex
    // surrounded by taller neighbours reads as a uniformly glowing
    // top, not 6 wedges meeting in a star at the centre. Vertices
    // between two lit edges round off smoothly because both edges'
    // tails contribute through the corner. Final clamp(0,1) on
    // altMask caps the cumulative brightness at saturation.
    float decayLength = mix(1.2, 0.05, ubuf.matteness) * i;

    float totalIntensity = 0.0;
    for (int k = 0; k < 6; k++) {
        float ang = float(k) * PI3;
        vec2 nDirK = vec2(cos(ang), sin(ang));
        vec2 nCenter  = cellCenter + nDirK * 2.0 * i;
        float nHeight = hexHeight(nCenter, ubuf.iTime);

        float perp = i - dot(local, nDirK);
        float distInBody = max(0.0, perp - seamWidth);

        if (nHeight > currentHeight + 0.005) {
            // Shorter side — full leak. Peak scales with diff.
            float diff = nHeight - currentHeight;
            float peakI = clamp(diff * 2.5, 0.0, 1.0);
            totalIntensity += peakI * exp(-distInBody / max(decayLength, 0.5));
        } else if (currentHeight > nHeight + 0.005) {
            // Taller side — minimal bleed onto its own face (the hex
            // is blocking most of the light). Same grazing model
            // but with a much shorter decay and bleedBack scalar.
            float diff = currentHeight - nHeight;
            float peakI = clamp(diff * 2.5, 0.0, 1.0);
            totalIntensity += peakI * exp(-distInBody / max(decayLength * 0.25, 0.5))
                            * ubuf.bleedBack;
        }
    }

    float scalesMask = clamp(totalIntensity * ubuf.heightAmount, 0.0, 1.0);

    // Sub-mode blend (lattice mode preserved unchanged).
    float altMask = mix(latticeMask, scalesMask, ubuf.subModeAmount);

    // On-body mask: 1 on the matte top, 0 inside the seam gap.
    // fwidth-based transition gives screen-space-aware AA so the seam
    // stays crisp without aliasing at any cellSize/zoom.
    float aa = fwidth(distToEdge);
    float onBody = smoothstep(seamWidth, seamWidth + aa, abs(distToEdge));

    // Seam height-gating: the seam between two hexes only glows where
    // those two hexes differ in height. Use the sextant bucket to pick
    // out WHICH neighbour shares this fragment's edge, then check that
    // specific neighbour's height differential. Same-height pairs read
    // as a dark hairline; height-differential pairs glow with the sun
    // colour that happens to be behind them. seamLit ramps from 0
    // (matched heights) to 1 (clearly differing heights).
    int kBucket = int(mod(bucket, 6.0));
    float angB = float(kBucket) * PI3;
    vec2 bucketDir = vec2(cos(angB), sin(angB));
    vec2 bucketNCenter = cellCenter + bucketDir * 2.0 * i;
    float bucketHeight = hexHeight(bucketNCenter, ubuf.iTime);
    float seamLit = smoothstep(0.02, 0.20, abs(bucketHeight - currentHeight));

    // Subtle matte texture on the hex top. Noise in screen-space at a
    // fine scale gives each top a barely-visible grain — enough to
    // break the flat-color look without competing with the leak glow.
    // Modulation amplitude scales gently with matteness.
    float matteTex = 1.0 + (noise(px * 0.08) - 0.5) * 0.25 * ubuf.matteness;
    vec3 bodyTopColor = ubuf.colorPrimaryContainer.rgb * matteTex;

    // Composition: seam glows only at height-diff edges, body picks up
    // directional leak from any taller neighbour (max-over-six, already
    // computed above into altMask). seamGlow scales both seam and leak
    // together so they brighten in lockstep.
    vec3 seamColor = lightFromSuns * ubuf.seamGlow * seamLit;
    float litWeight = altMask * ubuf.domeStrength;
    vec3 surfaceColor = bodyTopColor
                      + lightFromSuns * litWeight * ubuf.seamGlow;

    vec3 finalColorAlt = mix(seamColor, surfaceColor, onBody);

    // ── Mix 2D and alt (lattice/scales) modes ──────────────────────
    vec3 finalColor = mix(finalColor2D, finalColorAlt, ubuf.modeAmount);
    float a = mix(alpha2D, 1.0, ubuf.modeAmount);

    fragColor = vec4(finalColor * ubuf.intensity * ubuf.qt_Opacity,
                     a * ubuf.intensity * ubuf.qt_Opacity);
}
