#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// Main pass of the hexrain wallpaper. Two pre-passes feed it each frame
// (wired up by quickshell/Widgets/HexrainEffect.qml):
//   cellTex  — chrome_hexrain_cells.frag: per-cell data (2D stream
//              activations per edge, neighbour-leak coefficients, front-sun
//              cast shadows), sampled with nearest filtering.
//   lightTex — chrome_hexrain_light.frag: the smooth sun field on a coarse
//              grid, sampled bilinearly.
// This pass composes them with the per-pixel work: hex tiling, edge glow,
// the neighbour-height light leak, front-sun cast shadows and the flip wave.
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float iTime;
    float intensity;
    float cellSize;
    vec4 colorPrimary;
    vec4 colorSecondary;
    vec4 colorPrimaryContainer;
    vec4 colorTertiary;
    // Alt mode: point-light "suns" drift behind a hex grid where each
    // cell sits at its own height. Where neighbours differ in height the
    // shared seam glows with the sun colour from behind, and light leaks
    // onto the shorter neighbour's matte top via exponential decay.
    // modeAmount=0 = original 2D matrix-rain bar look; modeAmount=1 =
    // full height-leak look.
    float modeAmount;
    float domeStrength;    // 0..1 — multiplier on lit-zone intensity
    float seamGlow;        // 0..3 — multiplier on the lit portion
    float heightAmount;    // 0..1 — strength of the neighbour-height
                           //         leak effect overall.
    float matteness;       // 0..1 — surface "light friction". Low =
                           //         light travels far across the top;
                           //         high = light absorbed quickly.
    float bleedBack;       // 0..1 — small bleed of light onto the
                           //         taller hex's own edge (very subtle).
    float hexBevel;        // 0..1 — width of the dark groove between
                           //         adjacent hex tops.
    // Front suns: localised spotlights. Reach and colour come from the
    // light pass, each cell's cast-shadow geometry from the cell pass;
    // the shadow shapes are drawn here.
    float frontSunStrength;       // 0..N — brightness of each spotlight.
    float frontSunShadowDarkness; // 0..1 — peak shadow darkening.
    float frontSunCount;          // 0..10 — slot count.
    // ── Palette flip wave ────────────────────────────────────────
    // Propagating colour wave that sweeps the field, transitioning
    // each hex from the current body tint (colorPrimaryContainer) to
    // a staged target (colorPrimaryContainerNext). The wave radiates
    // outward from (flipOriginX, flipOriginY) at a configurable
    // speed; each hex transitions over flipDuration once its turn
    // arrives. At idle, flipStartTime should sit far in the future
    // (e.g. 1e9) so per-hex flip phase clamps to 0 everywhere.
    vec4 colorPrimaryNext;
    vec4 colorSecondaryNext;
    vec4 colorPrimaryContainerNext;
    vec4 colorTertiaryNext;
    float flipOriginX;
    float flipOriginY;
    float flipStartTime;
    float flipPropDelay;
    float flipDuration;
    // xy = this window's top-left in the virtual canvas (multi-monitor
    // wallpaper). zw = this window's pixel size. For single-monitor
    // surfaces, xy = 0 and zw = iResolution.xy. The frag computes
    //   px = qt_TexCoord0 * windowGeom.zw + windowGeom.xy
    // so noise/hex tiling/sun positions all live in one shared space
    // even when split across outputs.
    vec4 windowGeom;
    // Pre-pass texture geometry (see the pass shaders for layouts).
    float gridCols;
    float gridRows;
    float gridMargin;
    float gridCellTexels;
    float lightCols;
    float lightRows;
    float lightTexelPx;
} ubuf;

layout(binding = 1) uniform sampler2D cellTex;
layout(binding = 2) uniform sampler2D lightTex;

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


// Cell-pass texel j of the cell at lattice index `cell` (column, row).
vec4 cellTexel(vec2 cell, float j) {
    vec2 texel = vec2((cell.x + ubuf.gridMargin) * ubuf.gridCellTexels + j,
                      cell.y + ubuf.gridMargin);
    return texture(cellTex, (texel + 0.5)
                            / vec2(ubuf.gridCols * ubuf.gridCellTexels, ubuf.gridRows));
}

// Light leaking onto this hex across its edge toward neighbour k
// (angle k·60°): the taller-neighbour glow plus the always-on
// baseline, decaying over `decay` px of matte from the seam, and the
// faint bleed-back toward a shorter neighbour with its shorter decay.
// `reach` is the distance from centre to the inner edge of the seam.
float leakTerm(vec2 local, float k, float taller, float shorter,
               float reach, float decay, float bleedDecay) {
    float ang = k * PI3;
    float distInBody = max(0.0, reach - dot(local, vec2(cos(ang), sin(ang))));
    float t = (taller + 0.1) * exp(-distInBody / decay);
    if (shorter > 0.0)
        t += shorter * exp(-distInBody / bleedDecay);
    return t;
}


void main() {
    // Map this window's [0,1] quad coords into the virtual canvas. For
    // single-monitor surfaces windowGeom.xy = 0 and windowGeom.zw =
    // iResolution.xy, so this reduces to the original formula.
    vec2 px = qt_TexCoord0 * ubuf.windowGeom.zw + ubuf.windowGeom.xy;
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
    bool nearRow0 = dot(d0, d0) < dot(d1, d1);
    vec2 local = nearRow0 ? d0 : d1;
    vec2 cellCenter = px - local;
    vec2 cellIdx = nearRow0 ? vec2(col0, row0) : vec2(col1, row1);

    // ── Per-cell flip phase ───────────────────────────────────────
    // Distance from this cell to the flip origin, in hex steps. Each
    // hex starts its transition delayed by (hex steps from origin) ×
    // flipPropDelay, then walks 0 → 1 over flipDuration seconds. At
    // idle, flipStartTime is far in the future so this clamps to 0.
    vec2 flipOrigin = vec2(ubuf.flipOriginX, ubuf.flipOriginY);
    float distFromFlipOrigin = distance(cellCenter, flipOrigin);
    float stepsFromOrigin = distFromFlipOrigin / max(pitchY, 1.0);
    float cellFlipPhase = clamp(
        (ubuf.iTime - ubuf.flipStartTime - stepsFromOrigin * ubuf.flipPropDelay) /
        max(ubuf.flipDuration, 0.001),
        0.0, 1.0);

    // ── Edge identification ────────────────────────────────────────
    // Snap fragment angle to one of 6 edge buckets (every 60°).
    float angle = atan(local.y, local.x);
    if (angle < 0.0) angle += TWO_PI;
    float bucket = mod(floor(angle / PI3 + 0.5), 6.0);

    // This cell's texel for the facing edge: the 2D-layer stream
    // activations there (rgb).
    vec4 cell = cellTexel(cellIdx, bucket);
    float litA = cell.r;
    float litB = cell.g;
    float litC = cell.b;

    // ── Combined activation and color ──────────────────────────────
    // hotCol pre-weights each color by its own lit value so summing
    // gives correctly-weighted blends where streams overlap. lit total
    // is clamped at 1.0 for the alpha channel.
    // Each palette colour is blended with its "Next" counterpart by
    // the cell's flip phase, so the 2D background also transitions
    // during the wave (otherwise the 2D contribution snaps to the
    // post-commit palette when the swap happens, causing a final pop).
    vec3 primaryBlend   = mix(ubuf.colorPrimary.rgb,   ubuf.colorPrimaryNext.rgb,   cellFlipPhase);
    vec3 secondaryBlend = mix(ubuf.colorSecondary.rgb, ubuf.colorSecondaryNext.rgb, cellFlipPhase);
    vec3 tertiaryBlend  = mix(ubuf.colorTertiary.rgb,  ubuf.colorTertiaryNext.rgb,  cellFlipPhase);
    vec3 containerBlend = mix(ubuf.colorPrimaryContainer.rgb,
                              ubuf.colorPrimaryContainerNext.rgb, cellFlipPhase);
    vec3 hotCol = primaryBlend   * litA
               + secondaryBlend * litB
               + tertiaryBlend  * litC;

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
        containerBlend * interiorAlpha
      + primaryBlend  * outlineAlpha
      + hotCol * litGlowRaw;

    float alpha2D = clamp(interiorAlpha + outlineAlpha + litAlpha, 0.0, 1.0);

    // ── Scales + suns composition ──────────────────────────────────
    // Mental model: large soft "suns" drift in screen space behind a
    // foreground grid of hex-shaped scales. Each scale is dim in its
    // centre and bright at its rim, so the suns' colours read through
    // the seams between hexes — coloured light bleeding through
    // stained-glass scales. The sun field itself (underglow, front-sun
    // reach/colour, front-negative darkness) comes from the light pass;
    // the clamps keep the sampled texels on their own half.
    vec2 lightUV = clamp(px / ubuf.lightTexelPx,
                         vec2(0.5), vec2(ubuf.lightCols, ubuf.lightRows) - 0.5)
                 / vec2(ubuf.lightCols * 2.0, ubuf.lightRows);
    vec4 lightA = texture(lightTex, lightUV);
    vec4 lightB = texture(lightTex, lightUV + vec2(0.5, 0.0));
    vec3 lightFromSuns = lightA.rgb;
    float frontSunReach = lightA.a;
    vec3 frontSunColor = lightB.rgb;
    float frontDarkness = lightB.a;

    // Neighbour-height leak model (inspired by the gnomon wallpaper):
    // each hex is a flat matte-topped column at its own elevation.
    // Light is at "ground level" beneath the field; it bleeds out
    // from underneath each TALLER hex onto the rim of its shorter
    // neighbour. So a hex's top is lit only on the edges where it
    // borders a taller hex — direction and intensity per edge depend
    // on which neighbour is taller and by how much. A hex with no
    // taller neighbours is fully dark; a hex surrounded by taller
    // ones is lit on every side. The per-neighbour coefficients
    // (height difference, bar zone included) come from the cell pass.

    // Seam width: an always-on dark gap between adjacent hexes,
    // representing the visible groove between column tops. hexBevel
    // controls width. Floor at 0.5 px so it never disappears.
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
    // more light spills out. When THIS hex is the taller one, its
    // column blocks most of the gap from above, so only a faint
    // bleedBack-scaled residue with a quarter of the reach lands on
    // its own surface. Every seam also contributes a small baseline
    // bleed, keeping lit edges continuous across matched neighbours.
    //
    // SUM (not max) over the 6 neighbours so that when several edges
    // light up at once, their exponential tails add up — a hex
    // surrounded by taller neighbours reads as a uniformly glowing
    // top, not 6 wedges meeting in a star at the centre. Final
    // clamp(0,1) on altMask caps the cumulative brightness.
    float decayLength = mix(1.2, 0.05, ubuf.matteness) * i;
    float decay = max(decayLength, 0.5);
    float bleedDecay = max(decayLength * 0.25, 0.5);
    float reach = i - seamWidth;

    vec4 taller03 = cellTexel(cellIdx, 6.0);
    vec4 taller45 = cellTexel(cellIdx, 7.0);
    vec4 shorter03 = cellTexel(cellIdx, 8.0);
    vec4 shorter45 = cellTexel(cellIdx, 9.0);
    float totalIntensity =
        leakTerm(local, 0.0, taller03.x, shorter03.x, reach, decay, bleedDecay)
      + leakTerm(local, 1.0, taller03.y, shorter03.y, reach, decay, bleedDecay)
      + leakTerm(local, 2.0, taller03.z, shorter03.z, reach, decay, bleedDecay)
      + leakTerm(local, 3.0, taller03.w, shorter03.w, reach, decay, bleedDecay)
      + leakTerm(local, 4.0, taller45.x, shorter45.x, reach, decay, bleedDecay)
      + leakTerm(local, 5.0, taller45.y, shorter45.y, reach, decay, bleedDecay);

    float altMask = clamp(totalIntensity * ubuf.heightAmount, 0.0, 1.0);

    // ── Front-sun cast shadows ────────────────────────────────────
    // Each front sun throws a hex-shaped shadow onto this cell (centre,
    // size and weight from the cell pass); the darkest applicable
    // shadow wins (max).
    int nFrontPos = int(ubuf.frontSunCount + 0.5);
    float castShadow = 0.0;
    for (int s = 0; s < 10; s++) {
        if (s >= nFrontPos) break;
        vec4 shadow = cellTexel(cellIdx, 10.0 + float(s));
        if (shadow.w > 0.0) {
            float hexDist = sdHexagon((px - shadow.xy).yx, shadow.z);
            float shadowMask = 1.0 - smoothstep(-shadow.z * 0.4,
                                                shadow.z * 0.7,
                                                hexDist);
            castShadow = max(castShadow, shadow.w * shadowMask);
        }
    }

    // On-body mask: 1 on the matte top, 0 inside the seam gap.
    // fwidth-based transition gives screen-space-aware AA so the seam
    // stays crisp without aliasing at any cellSize/zoom.
    float aa = fwidth(distToEdge);
    float onBody = smoothstep(seamWidth, seamWidth + aa, abs(distToEdge));

    // Subtle matte texture on the hex top. Noise in screen-space at a
    // fine scale gives each top a barely-visible grain — enough to
    // break the flat-color look without competing with the leak glow.
    // Modulation amplitude scales gently with matteness.
    float matteTex = 1.0 + (noise(px * 0.08) - 0.5) * 0.25 * ubuf.matteness;

    // ── Propagating colour wave ───────────────────────────────────
    // The wave passes through the tertiary colour at its midpoint —
    // the body transitions old → tertiary (bright highlight) → new.
    // This reads as a bright wave-front sweeping the field, leaving
    // hexes in the new colour behind it. At cellFlipPhase = 0 or 1,
    // the body is fully one of the palette ends; the highlight peaks
    // at cellFlipPhase = 0.5.
    vec3 oldBodyTint  = ubuf.colorPrimaryContainer.rgb;
    vec3 newBodyTint  = ubuf.colorPrimaryContainerNext.rgb;
    vec3 peakBodyTint = ubuf.colorTertiary.rgb;
    vec3 flipBodyTint;
    if (cellFlipPhase < 0.5) {
        flipBodyTint = mix(oldBodyTint, peakBodyTint, cellFlipPhase * 2.0);
    } else {
        flipBodyTint = mix(peakBodyTint, newBodyTint, (cellFlipPhase - 0.5) * 2.0);
    }

    // Ambient body colour — what every hex would look like with no
    // front sun. Dark matte container tint, broken by the noise grain.
    vec3 ambientBody = flipBodyTint * matteTex;

    // Front-sun illumination: light from the localised moving suns,
    // additive on top of the ambient body and gated by frontSunReach
    // so only the hexes underneath a sun get the boost. Cast shadows
    // are gated by reach too (no shadows where no sun shines), and
    // clamped so cranked-up strengths leave some ambient colour in
    // shadow zones rather than pitch black.
    vec3 sunLight = frontSunColor * ubuf.frontSunStrength * 0.6;
    // Shadow visibility gates on the sun being *on* (strength > 0)
    // but not on its brightness — so shadowDarkness controls dark
    // depth independently. Without this decoupling, at low sun
    // strengths the shadowDarkness slider has no perceptible range.
    float shadowGate = smoothstep(0.0, 0.05, ubuf.frontSunStrength);
    float shadowDarken = clamp(castShadow * ubuf.frontSunShadowDarkness
                               * shadowGate * frontSunReach,
                               0.0, 0.995);
    float litness = frontSunReach * (1.0 - shadowDarken);

    vec3 bodyTopColor = ambientBody + sunLight * litness;
    // Front-negative-sun attenuation: anti-spots eat brightness in
    // their reach. Applied to the full bodyTopColor so the effect is
    // visible even without a positive front sun (it darkens ambient
    // too) and also kills positive sun light where they overlap.
    bodyTopColor *= (1.0 - frontDarkness);

    // Composition: seams show the sun field directly; the body picks
    // up the neighbour-height leak (altMask). seamGlow scales both
    // seam and leak together so they brighten in lockstep.
    vec3 seamColor = lightFromSuns * ubuf.seamGlow;
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
