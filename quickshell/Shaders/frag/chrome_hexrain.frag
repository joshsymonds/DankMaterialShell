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
    // Alt mode: 2D point-light "suns" drift behind a hex grid where
    // each cell sits at its own height. Where neighbours differ in
    // height the shared seam glows with the sun colour from behind,
    // and light leaks onto the shorter neighbour's matte top via
    // exponential decay. modeAmount=0 = original 2D matrix-rain
    // bar look; modeAmount=1 = full height-leak look.
    float modeAmount;
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
    float frontSunStrength; // 0..N — brightness of the front-sun
                            //         pass. 0 disables. The front sun
                            //         is a single localised light
                            //         (NOT directional) that drifts
                            //         across the field on a Lissajous
                            //         path; hexes near it get the
                            //         additive warm illumination,
                            //         hexes far from it stay at
                            //         ambient body colour.
    float frontSunSpeed;    // 0..N — orbit rate of the front-sun
                            //         position. 0 freezes it.
    float frontSunSize;     // 0..1 — radius of the sun's reach as a
                            //         fraction of the larger screen
                            //         dimension. Small = tight focused
                            //         spotlight; large = broad wash.
    float frontSunShadowLength;  // 0..N — multiplier on the cast
                                 //         shadow's decay length.
                                 //         1 = baseline; higher
                                 //         stretches shadows deeper
                                 //         across receiver hexes.
    float frontSunShadowDarkness; // 0..1 — peak darkening a cast
                                  //         shadow can apply to a
                                  //         body, before clamping.
                                  //         Higher = inkier shadows.
    float backSunSize;       // 0..1 — gaussian sigma of each back
                             //         (underglow) sun, as a fraction
                             //         of the larger screen dim. Small
                             //         = tight isolated suns with deep
                             //         dark between; large = broad
                             //         overlapping wash.
    float backSunStrength;   // 0..N — overall intensity multiplier on
                             //         the back-sun additive light.
                             //         Dial below 1 to darken the
                             //         field, above 1 to push toward
                             //         fully-saturated hue at peaks.
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

    // Gaussian falloff. sigma is backSunSize × max screen dim so the
    // user can dial the suns from tight isolated pools to broad
    // overlapping washes.
    float sigma = max(ubuf.backSunSize *
                      max(ubuf.iResolution.x, ubuf.iResolution.y), 1.0);
    float invSig2 = 1.0 / (sigma * sigma);
    vec2 dA = px - sunPosA;
    vec2 dB = px - sunPosB;
    vec2 dC = px - sunPosC;
    float gA = exp(-dot(dA, dA) * invSig2);
    float gB = exp(-dot(dB, dB) * invSig2);
    float gC = exp(-dot(dC, dC) * invSig2);

    vec3 lightRaw = (ubuf.colorPrimary.rgb   * gA
                  +  ubuf.colorSecondary.rgb * gB
                  +  ubuf.colorTertiary.rgb  * gC) * ubuf.backSunStrength;
    // Hue-preserving cap on the sun field itself. When three
    // saturated sun colours overlap, the raw additive sum can push
    // every channel past 1.0 → would otherwise clip to neutral white.
    // Capping at the source keeps the field "always coloured" without
    // dimming the downstream body/seam shading — peak brightness in
    // saturated zones still pushes surfaceColor toward saturation,
    // but in whichever sun's hue dominates locally, not in white.
    float lightMax = max(lightRaw.r, max(lightRaw.g, lightRaw.b));
    vec3 lightFromSuns = lightRaw / max(lightMax, 1.0);

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

    // Front-sun: a single localised light source that drifts across
    // the field on a slow Lissajous path. Unlike a directional sun
    // (which would illuminate every hex equally regardless of where
    // they sit on screen), this one has a POSITION — hexes near it
    // are brightly lit, hexes far from it stay at ambient. As it
    // moves, the lit region sweeps across the field; tall hexes
    // near the sun cast shadows radiating outward from its position.
    float fst = ubuf.iTime * 0.05 * ubuf.frontSunSpeed;
    vec2 frontSunPos = ubuf.iResolution.xy * 0.5 + ubuf.iResolution.xy * 0.45 *
                       vec2(cos(fst * 0.23 + 0.5), sin(fst * 0.31 + 1.7));

    // Sun reach: Gaussian falloff sigma in pixels. frontSunSize scales
    // it as a fraction of the larger screen dimension.
    float frontSunSigma = max(ubuf.frontSunSize *
                              max(ubuf.iResolution.x, ubuf.iResolution.y) * 0.5,
                              1.0);

    // Per-pixel proximity to the sun → drives body brightening.
    vec2 toFrontSun = frontSunPos - px;
    float frontSunReach = exp(-dot(toFrontSun, toFrontSun) /
                              (frontSunSigma * frontSunSigma));

    // Per-CELL reach (computed at the cell centre, used uniformly
    // across all fragments in this cell). This is the cell's
    // "size" / "presence" — how lit the front sun makes this hex.
    // Differential in cell-reach between this hex and a neighbour
    // drives the cast-shadow logic: the brighter (more present)
    // hex casts a shadow onto its less-lit neighbour.
    vec2 cellToFrontSun = frontSunPos - cellCenter;
    float cellReach = exp(-dot(cellToFrontSun, cellToFrontSun) /
                          (frontSunSigma * frontSunSigma));

    float totalIntensity = 0.0;
    float castShadow = 0.0;
    for (int k = 0; k < 6; k++) {
        float ang = float(k) * PI3;
        vec2 nDirK = vec2(cos(ang), sin(ang));
        vec2 nCenter  = cellCenter + nDirK * 2.0 * i;
        float nHeight = hexHeight(nCenter, ubuf.iTime);

        float perp = i - dot(local, nDirK);
        float distInBody = max(0.0, perp - seamWidth);

        // Height-driven leak (dominant): a taller neighbour throws a
        // strong glow onto this hex's edge facing it, scaling with
        // the height differential. Conversely, when THIS hex is the
        // taller one, its column blocks most of the gap from above
        // so only a faint bleedBack-scaled residue reaches its own
        // surface.
        if (nHeight > currentHeight + 0.005) {
            float diff = nHeight - currentHeight;
            float peakI = clamp(diff * 2.5, 0.0, 1.0);
            totalIntensity += peakI * exp(-distInBody / max(decayLength, 0.5));
        } else if (currentHeight > nHeight + 0.005) {
            float diff = currentHeight - nHeight;
            float peakI = clamp(diff * 2.5, 0.0, 1.0);
            totalIntensity += peakI * exp(-distInBody / max(decayLength * 0.25, 0.5))
                            * ubuf.bleedBack;
        }

        // Baseline leak (always present, small): every seam is a gap
        // revealing some underlying sun light, so even same-height
        // seams contribute a tiny bleed onto the adjacent body. This
        // is what stops lit edges from ending abruptly at matched
        // neighbours — there's always continuity across the seam.
        // Kept small so it doesn't saturate when summed across all
        // 6 edges and overwhelm the matte body colour.
        totalIntensity += 0.1 * exp(-distInBody / max(decayLength, 0.5));

        // Cast-shadow check — separate from the height-based leak.
        // Each cell has a "size" = its lit-ness from the front sun
        // (reach at the cell centre). A more-lit neighbour casts a
        // hex-shaped shadow onto this less-lit cell. Shadow size
        // grows with the lit differential and frontSunShadowLength.
        //
        // Position: a hex offset from this cell's centre toward the
        // brighter neighbour's edge — so the shadow lives on the
        // receiver's sun-facing side and shaped like a hex pushing
        // in across the seam. Smoothstep on litDiff prevents the
        // abrupt on/off you'd otherwise see as the reach differential
        // drifts across the activation threshold.
        vec2 nToFrontSun = frontSunPos - nCenter;
        float nReach = exp(-dot(nToFrontSun, nToFrontSun) /
                           (frontSunSigma * frontSunSigma));
        float litDiff = nReach - cellReach;
        if (litDiff > 0.001) {
            float diffWeight = smoothstep(0.001, 0.05, litDiff);
            // Position shadow hex well past the receiver's edge facing
            // the brighter neighbour, and size it large enough to
            // sweep across the receiver. This places the smoothstep
            // transition band OUTSIDE the receiver (or at its very
            // far edge) instead of through the middle — so when
            // multiple neighbours cast simultaneously their
            // transitions don't pile up near the centre. Result is a
            // smooth gradient from full dark on the sun-facing edge
            // to clear on the away side.
            vec2 shadowCenter = cellCenter + nDirK * (i * 1.3);
            float shadowSize  = i * (1.2 + litDiff * 2.0 * ubuf.frontSunShadowLength);
            vec2 fromShadow = px - shadowCenter;
            float hexDist = sdHexagon(fromShadow.yx, shadowSize);
            float shadowMask = 1.0 - smoothstep(-shadowSize * 0.4,
                                                shadowSize * 0.7,
                                                hexDist);
            float thisShadow = diffWeight * clamp(litDiff * 2.5, 0.0, 1.0) * shadowMask;
            castShadow = max(castShadow, thisShadow);
        }
    }

    float altMask = clamp(totalIntensity * ubuf.heightAmount, 0.0, 1.0);

    // On-body mask: 1 on the matte top, 0 inside the seam gap.
    // fwidth-based transition gives screen-space-aware AA so the seam
    // stays crisp without aliasing at any cellSize/zoom.
    float aa = fwidth(distToEdge);
    float onBody = smoothstep(seamWidth, seamWidth + aa, abs(distToEdge));

    // (Seam height-gating used to live here, gating seam glow on
    // adjacent height differential. Removed — the seam is now treated
    // as an always-open gap revealing the sun field beneath, with no
    // special edge-lighting logic. Light intensity at the seam comes
    // directly from lightFromSuns, and the leak loop above ensures
    // the same light bleeds onto both adjacent bodies.)

    // Subtle matte texture on the hex top. Noise in screen-space at a
    // fine scale gives each top a barely-visible grain — enough to
    // break the flat-color look without competing with the leak glow.
    // Modulation amplitude scales gently with matteness.
    float matteTex = 1.0 + (noise(px * 0.08) - 0.5) * 0.25 * ubuf.matteness;

    // Ambient body colour — what every hex would look like with no
    // front sun. Dark matte container tint, broken by the noise grain.
    vec3 ambientBody = ubuf.colorPrimaryContainer.rgb * matteTex;

    // Front-sun illumination: warm light from the localised moving
    // sun. Additive on top of the ambient body, and GATED by
    // frontSunReach so only the hexes underneath the sun get the
    // boost. As the sun drifts, the lit region sweeps across the
    // field — far hexes stay at ambient (dark matte), near hexes
    // brighten and at high strengths saturate toward white.
    //
    // shadowDarken comes from the neighbour loop above (tall hexes
    // near the sun cast shadows on lower hexes opposite the sun).
    // It's also gated by reach — no shadows where the sun isn't
    // shining anyway. Clamped at 0.92 so cranked-up strengths leave
    // some ambient colour in shadow zones rather than pitch black.
    vec3 sunLight = vec3(1.0, 0.95, 0.85) * ubuf.frontSunStrength * 0.6;
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

    // Composition: seam glows only at height-diff edges, body picks up
    // directional leak from any taller neighbour (max-over-six, already
    // computed above into altMask). seamGlow scales both seam and leak
    // together so they brighten in lockstep.
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
