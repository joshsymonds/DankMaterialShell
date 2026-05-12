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
    // ── Suns (unified placement) ─────────────────────────────────
    // Every sun in every category follows the same lifecycle: spawn at
    // a hashed point along a random edge, traverse a straight line to
    // a hashed point along a *different* random edge over `lifetime`
    // seconds, then sit invisible for `gap` seconds (with a random
    // offset within the cycle for unpredictability) before the slot
    // respawns from a fresh pair of edges. Per-slot phase staggers
    // ensure slots don't bunch up. See sunPlacement() below.
    float frontSunStrength;       // 0..N — brightness of each spotlight.
    float frontSunSize;           // 0..1 — gaussian sigma as fraction of
                                  //         larger virtual canvas dim.
    float frontSunLifetime;       // sec — how long each appearance lasts.
    float frontSunGap;            // sec — mean dead time between appearances.
    float frontSunSpeed;          // wander rate (Perlin time scale).
    float frontSunShadowLength;   // 0..N — cast-shadow decay length mult.
    float frontSunShadowDarkness; // 0..1 — peak shadow darkening.
    float backSunSize;            // 0..1 — sigma of back (underglow) suns.
    float backSunStrength;        // 0..N — additive light intensity mult.
    float backSunLifetime;        // sec.
    float backSunGap;             // sec.
    float backSunSpeed;           // wander rate.
    float backNegSunSize;         // 0..1 — anti-light sigma.
    float backNegSunStrength;     // 0..1 — depth of darkening at centre.
    float backNegSunLifetime;     // sec.
    float backNegSunGap;          // sec.
    float backNegSunSpeed;        // wander rate.
    float backSunPaletteSpeed;    // 0..N — palette cycle rate.
    float frontSunPaletteSpeed;   // 0..N — palette cycle rate.
    float backSunCount;           // 0..10 — slot count.
    float backNegSunCount;        // 0..10.
    float frontSunCount;          // 0..10.
    float frontNegSunCount;       // 0..10.
    float frontNegSunStrength;    // 0..1 — body darkening depth.
    float frontNegSunSize;        // 0..1.
    float frontNegSunLifetime;    // sec.
    float frontNegSunGap;         // sec.
    float frontNegSunSpeed;       // wander rate.
    // Single-slot fast streak that lives separately from the slow back
    // sun pool — its own lifetime/gap/speed so you can dial in a quiet
    // background of slow suns + the occasional zippy comet that
    // wanders briefly across the canvas before fading. Uses the same
    // sunPlacement() machinery as everything else.
    float fastBackSunStrength;
    float fastBackSunSize;
    float fastBackSunLifetime;
    float fastBackSunGap;
    float fastBackSunSpeed;
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

// Smooth palette cycle: maps a continuous phase to a colour that
// morphs through primary → secondary → tertiary → primary as the
// phase walks 0 → 1 → 2 → 3. Used to rotate the three back-sun
// colours over time at backSunPaletteSpeed.
vec3 paletteCycle(float phase) {
    phase = mod(phase, 3.0);
    int idx = int(phase);
    float frac = phase - float(idx);
    vec3 c0, c1;
    if (idx == 0) {
        c0 = ubuf.colorPrimary.rgb;
        c1 = ubuf.colorSecondary.rgb;
    } else if (idx == 1) {
        c0 = ubuf.colorSecondary.rgb;
        c1 = ubuf.colorTertiary.rgb;
    } else {
        c0 = ubuf.colorTertiary.rgb;
        c1 = ubuf.colorPrimary.rgb;
    }
    return mix(c0, c1, frac);
}

// Same as paletteCycle but using the "Next" palette colours. Used
// when the flip wave has reached a sun's position — that sun's
// emitted colour blends from paletteCycle → paletteCycleNext based
// on the sun's own per-position flip phase.
vec3 paletteCycleNext(float phase) {
    phase = mod(phase, 3.0);
    int idx = int(phase);
    float frac = phase - float(idx);
    vec3 c0, c1;
    if (idx == 0) {
        c0 = ubuf.colorPrimaryNext.rgb;
        c1 = ubuf.colorSecondaryNext.rgb;
    } else if (idx == 1) {
        c0 = ubuf.colorSecondaryNext.rgb;
        c1 = ubuf.colorTertiaryNext.rgb;
    } else {
        c0 = ubuf.colorTertiaryNext.rgb;
        c1 = ubuf.colorPrimaryNext.rgb;
    }
    return mix(c0, c1, frac);
}

// Unified sun placement. Each slot lives in a (lifetime + gap)-second
// cycle. Within an active window the sun's position is a Perlin-style
// noise lookup of (time * speed), so it wanders smoothly and never
// repeats. A per-appearance hash shifts the noise time axis, so
// consecutive appearances trace genuinely different paths — fading in
// somewhere, wandering, fading out somewhere else.
//
//   slotId:   stable per-slot identifier (mix in a per-type constant
//             so the same numeric slot in two categories doesn't share
//             a trajectory)
//   lifetime: how long each appearance lasts (sec)
//   gap:      mean dead time between appearances in this slot (sec)
//   speed:    wander rate; low = barely moves, high = visibly drifts
//   t:        scaled time (iTime * sunDriftSpeed)
//
// Returns:
//   xy = world-space position in the virtual canvas
//   z  = active mask 0..1 (smooth fade-in/out at endpoints)
//   w  = per-appearance hash 0..1 (palette-phase offset etc.)
vec4 sunPlacement(float slotId, float lifetime, float gap, float speed, float t) {
    float cyclePeriod = max(lifetime + gap, 0.05);
    // Per-slot phase: stagger so multiple slots don't all spawn at the
    // same moment. Constant across cycles for this slot.
    float slotPhase = hash(vec2(slotId * 41.0 + 17.0, 7.3)) * cyclePeriod;

    float tLocal = t - slotPhase;
    float cycleIdx = floor(tLocal / cyclePeriod);
    float cycleT = tLocal - cycleIdx * cyclePeriod;

    // Per-appearance hash seed (unique per slot+cycle).
    vec2 seed = vec2(slotId * 41.0 + 17.0, cycleIdx * 31.0 + 5.0);

    // Semi-random start within the gap window — gives unpredictable
    // appearance cadence without breaking cycle period.
    float startDelay = hash(seed + vec2(0.0, 23.0)) * gap;
    float life = cycleT - startDelay;
    float fInLife = clamp(life / max(lifetime, 0.001), 0.0, 1.0);
    float aliveWindow = step(0.0, life) * step(life, lifetime);
    // Soft fade-in/out so the sun doesn't pop at the endpoints —
    // visually it just materialises out of/dissolves into the field.
    float fade = smoothstep(0.0, 0.08, fInLife) * smoothstep(1.0, 0.92, fInLife);
    float activeMask = aliveWindow * fade;

    // Per-appearance offsets into the noise time axis so each
    // appearance starts from a different point in the noise field —
    // ensures consecutive appearances don't look like the same loop.
    // 100x scale spreads them far apart.
    float ox = hash(seed + vec2(7.0, 0.0)) * 100.0;
    float oy = hash(seed + vec2(0.0, 7.0)) * 100.0;

    // 2D noise wander. The y-axis seed in each noise() call is a
    // constant slice (= per-slot identifier), so as t advances the
    // lookup walks smoothly along a 1D slice of the 2D noise field.
    // x and y use different slices so their motions are uncorrelated.
    float wx = noise(vec2(t * speed + ox, slotId * 13.0 + 11.0));
    float wy = noise(vec2(t * speed + oy, slotId * 13.0 + 91.0));

    // Map noise [0,1] onto the canvas with a small overshoot margin
    // so the sun can drift just off-edge (then back) for variety.
    float margin = 0.18;
    vec2 pos = ubuf.iResolution.xy * vec2(
        mix(-margin, 1.0 + margin, wx),
        mix(-margin, 1.0 + margin, wy));

    return vec4(pos, activeMask, hash(seed + vec2(41.0, 17.0)));
}

// Per-position flip phase. Same math as cellFlipPhase but takes an
// arbitrary world-space position — used for sun positions so each
// sun's colour transitions when the wave reaches IT.
float positionFlipPhase(vec2 worldPos, float pitchY) {
    vec2 flipOrigin = vec2(ubuf.flipOriginX, ubuf.flipOriginY);
    float distFromOrigin = distance(worldPos, flipOrigin);
    float steps = distFromOrigin / max(pitchY, 1.0);
    return clamp(
        (ubuf.iTime - ubuf.flipStartTime - steps * ubuf.flipPropDelay) /
        max(ubuf.flipDuration, 0.001),
        0.0, 1.0);
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
    vec2 local = (dot(d0, d0) < dot(d1, d1)) ? d0 : d1;
    vec2 cellCenter = px - local;

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
    // Mental model: three large soft "suns" drift in screen space behind
    // a foreground grid of hex-shaped scales. Each scale is dim in its
    // centre and bright at its rim, so the suns' colours read through
    // the seams between hexes. With suns at different positions painting
    // primary/secondary/tertiary, every seam picks up whichever sun is
    // nearest behind it — the field looks like coloured light bleeding
    // through stained-glass scales.

    // N back-positive suns. Each slot uses sunPlacement() to traverse
    // the virtual canvas edge-to-edge over backSunLifetime seconds,
    // then sits invisibly for backSunGap seconds (with a random
    // start-offset per cycle) before respawning from a fresh pair of
    // edges. Slots stagger by per-slot hash so they don't bunch.
    //
    // Hard cap of 10 — loop is bounded by a compile-time constant
    // with `break` when the dynamic count is reached.
    float t = ubuf.iTime * ubuf.sunDriftSpeed;

    float sigma = max(ubuf.backSunSize *
                      max(ubuf.iResolution.x, ubuf.iResolution.y), 1.0);
    float invSig2 = 1.0 / (sigma * sigma);

    int nBackPos = int(ubuf.backSunCount + 0.5);
    float fnBackPos = max(float(nBackPos), 1.0);

    vec3 lightRaw = vec3(0.0);
    for (int s = 0; s < 10; s++) {
        if (s >= nBackPos) break;
        // Per-type constant (+7.0) so the same numeric slot in another
        // sun category gets a completely different hash trajectory.
        vec4 place = sunPlacement(float(s) + 7.0,
                                  ubuf.backSunLifetime,
                                  ubuf.backSunGap,
                                  ubuf.backSunSpeed,
                                  t);
        vec2 sunPos = place.xy;
        float actMask = place.z;
        float colorHash = place.w;

        vec2 d = px - sunPos;
        float g = exp(-dot(d, d) * invSig2);
        // Per-slot colour distribution: each slot owns a 1/count slice
        // of the palette (so two slots can't pile onto the same hue at
        // spawn). colorHash dithers within that slice so the EXACT
        // hue varies appearance-to-appearance. Per-sun rate variance
        // (0.6x..1.4x of backSunPaletteSpeed) lets neighbours drift
        // past each other only briefly — most of the time they look
        // visibly distinct.
        float segWidth = 3.0 / fnBackPos;
        float slotAnchor = float(s) * segWidth;
        float slotJitter = (colorHash - 0.5) * segWidth * 0.8;
        float rateVar = 0.6 + colorHash * 0.8;
        float phaseColor = ubuf.iTime * 0.1 * ubuf.backSunPaletteSpeed * rateVar
                         + slotAnchor + slotJitter;
        float sunFlip = positionFlipPhase(sunPos, pitchY);
        vec3 col = mix(paletteCycle(phaseColor),
                       paletteCycleNext(phaseColor),
                       sunFlip);
        lightRaw += col * g * actMask;
    }
    lightRaw *= ubuf.backSunStrength;

    // ── Fast back sun: one streak with its own clock ─────────────
    // Lives outside the regular back-sun pool so you can layer a quiet
    // background of slow suns with the occasional fast streak. Same
    // placement model, just dialled hot — short lifetime, higher
    // speed. Strength applies AFTER backSunStrength so it has its
    // own brightness knob; goes into lightRaw before the hue cap so
    // overlap with slow suns saturates gracefully.
    if (ubuf.fastBackSunStrength > 0.001) {
        vec4 fbPlace = sunPlacement(401.0,
                                    ubuf.fastBackSunLifetime,
                                    ubuf.fastBackSunGap,
                                    ubuf.fastBackSunSpeed,
                                    t);
        vec2 fbPos = fbPlace.xy;
        float fbActMask = fbPlace.z;
        float fbColorHash = fbPlace.w;

        float fbSigma = max(ubuf.fastBackSunSize *
                            max(ubuf.iResolution.x, ubuf.iResolution.y), 1.0);
        float fbInvSig2 = 1.0 / (fbSigma * fbSigma);
        vec2 fbD = px - fbPos;
        float fbG = exp(-dot(fbD, fbD) * fbInvSig2);

        // Per-appearance random palette phase: each streak picks a
        // fresh hue from the cycle so consecutive appearances don't
        // look the same. Shares the back-sun palette clock so the
        // wallpaper's overall colour rotation stays unified.
        float fbPhase = ubuf.iTime * 0.1 * ubuf.backSunPaletteSpeed
                      + fbColorHash * 3.0;
        float fbFlip = positionFlipPhase(fbPos, pitchY);
        vec3 fbCol = mix(paletteCycle(fbPhase),
                         paletteCycleNext(fbPhase),
                         fbFlip);
        lightRaw += fbCol * fbG * fbActMask * ubuf.fastBackSunStrength;
    }

    // Hue-preserving cap on the sun field itself. When three
    // saturated sun colours overlap, the raw additive sum can push
    // every channel past 1.0 → would otherwise clip to neutral white.
    // Capping at the source keeps the field "always coloured" without
    // dimming the downstream body/seam shading — peak brightness in
    // saturated zones still pushes surfaceColor toward saturation,
    // but in whichever sun's hue dominates locally, not in white.
    float lightMax = max(lightRaw.r, max(lightRaw.g, lightRaw.b));
    vec3 lightFromSuns = lightRaw / max(lightMax, 1.0);

    // Negative back suns: anti-lights that attenuate whatever underglow
    // happens to be there. Same placement model as the positives, so
    // each void enters from a random edge and exits via another —
    // creating shifting dark patches that drift through the field.
    // Per-type offset (+101.0) ensures negatives don't share trajectories
    // with positives that happen to use the same slot index.
    float negSunSigma = max(ubuf.backNegSunSize *
                            max(ubuf.iResolution.x, ubuf.iResolution.y), 1.0);
    float negInvSig2 = 1.0 / (negSunSigma * negSunSigma);
    int nBackNeg = int(ubuf.backNegSunCount + 0.5);
    for (int s = 0; s < 10; s++) {
        if (s >= nBackNeg) break;
        vec4 place = sunPlacement(float(s) + 101.0,
                                  ubuf.backNegSunLifetime,
                                  ubuf.backNegSunGap,
                                  ubuf.backNegSunSpeed,
                                  t);
        vec2 negSunPos = place.xy;
        float actMask = place.z;
        vec2 toNegSun = negSunPos - px;
        float negSunReach = exp(-dot(toNegSun, toNegSun) * negInvSig2);
        float darkFactor = clamp(negSunReach * ubuf.backNegSunStrength * actMask,
                                 0.0, 0.98);
        lightFromSuns *= (1.0 - darkFactor);
    }

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

    // ── Height-leak loop: per-edge bleed from height differentials.
    // Independent of front-sun stuff so it runs unconditionally over
    // the 6 neighbours of this cell.
    float totalIntensity = 0.0;
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
    }

    float altMask = clamp(totalIntensity * ubuf.heightAmount, 0.0, 1.0);

    // ── Front-positive suns: N localised spotlights using the same
    // edge-to-edge placement as the back suns. Each illuminates hexes
    // within its reach and casts hex-shaped shadows from taller-reach
    // neighbours onto lower-reach receivers. Reaches accumulate across
    // all suns; shadows take the max (the darkest applicable wins).
    // Per-type offset (+211.0) keeps trajectories distinct from
    // every other sun category.
    float frontSunSigma = max(ubuf.frontSunSize *
                              max(ubuf.iResolution.x, ubuf.iResolution.y) * 0.5,
                              1.0);
    float frontInvSig2 = 1.0 / (frontSunSigma * frontSunSigma);
    int nFrontPos = int(ubuf.frontSunCount + 0.5);

    float frontSunReach = 0.0;
    float castShadow = 0.0;
    // Weighted-average flip phase across front suns. Used to blend
    // the front-sun colour from current → next palette when the
    // wave has swept through the suns' positions.
    float frontFlipBlend = 0.0;
    float frontFlipWeight = 0.0;
    for (int s = 0; s < 10; s++) {
        if (s >= nFrontPos) break;
        vec4 place = sunPlacement(float(s) + 211.0,
                                  ubuf.frontSunLifetime,
                                  ubuf.frontSunGap,
                                  ubuf.frontSunSpeed,
                                  t);
        vec2 sunPos = place.xy;
        float actMask = place.z;

        vec2 toSun = sunPos - px;
        float pxReach = exp(-dot(toSun, toSun) * frontInvSig2) * actMask;
        frontSunReach += pxReach;
        // Accumulate per-sun flip phase weighted by pxReach so suns
        // contributing more to this pixel dominate its colour blend.
        frontFlipBlend  += positionFlipPhase(sunPos, pitchY) * pxReach;
        frontFlipWeight += pxReach;

        vec2 cellToSun = sunPos - cellCenter;
        float cellToSunLen = length(cellToSun);
        float cellR = exp(-dot(cellToSun, cellToSun) * frontInvSig2);

        // Continuous-direction cast shadow. The caster is a virtual
        // point at distance 2i from this cell in the sun's direction
        // — its position rotates smoothly with the sun, so there's no
        // 6-neighbour rank-swap that would cause the shadow to pop
        // to a different side. Same hex-shape and intensity math as
        // the original; only the caster selection changed.
        if (cellToSunLen > 0.001) {
            vec2 sunDir = cellToSun / cellToSunLen;
            vec2 virtualCaster = cellCenter + sunDir * 2.0 * i;
            vec2 vcToSun = sunPos - virtualCaster;
            float vcR = exp(-dot(vcToSun, vcToSun) * frontInvSig2);
            float litDiff = vcR - cellR;
            if (litDiff > 0.001) {
                float diffWeight = smoothstep(0.001, 0.05, litDiff);
                vec2 shadowCenter = cellCenter + sunDir * (i * 1.3);
                float shadowSize = i * (1.2 + litDiff * 2.0 * ubuf.frontSunShadowLength);
                vec2 fromShadow = px - shadowCenter;
                float hexDist = sdHexagon(fromShadow.yx, shadowSize);
                float shadowMask = 1.0 - smoothstep(-shadowSize * 0.4,
                                                    shadowSize * 0.7,
                                                    hexDist);
                float thisShadow = diffWeight * clamp(litDiff * 2.5, 0.0, 1.0)
                                 * shadowMask * actMask;
                castShadow = max(castShadow, thisShadow);
            }
        }
    }
    // Multiple suns can sum past 1; clamp so litness math stays
    // bounded. The hue is fixed (single frontSunColor) regardless of
    // count, so saturating is the right behaviour rather than a
    // hue-cap.
    frontSunReach = clamp(frontSunReach, 0.0, 1.0);

    // ── Front-negative suns: anti-spots that DARKEN bodies in their
    // reach. Independent placement (+307.0 type offset) so they don't
    // share trajectories with the positives. Strongest one at this
    // pixel wins (max, not sum) so multiple piling up don't go past
    // the strength cap.
    float frontNegSigma = max(ubuf.frontNegSunSize *
                              max(ubuf.iResolution.x, ubuf.iResolution.y) * 0.5,
                              1.0);
    float frontNegInvSig2 = 1.0 / (frontNegSigma * frontNegSigma);
    int nFrontNeg = int(ubuf.frontNegSunCount + 0.5);
    float frontDarkness = 0.0;
    for (int s = 0; s < 10; s++) {
        if (s >= nFrontNeg) break;
        vec4 place = sunPlacement(float(s) + 307.0,
                                  ubuf.frontNegSunLifetime,
                                  ubuf.frontNegSunGap,
                                  ubuf.frontNegSunSpeed,
                                  t);
        vec2 negPos = place.xy;
        float actMask = place.z;
        vec2 toNeg = negPos - px;
        float reach = exp(-dot(toNeg, toNeg) * frontNegInvSig2) * actMask;
        frontDarkness = max(frontDarkness, reach * ubuf.frontNegSunStrength);
    }
    frontDarkness = clamp(frontDarkness, 0.0, 0.98);

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
    // Front-sun colour starts at colorTertiary (so monochrome palettes
    // get monochrome front sun for free, and matugen-theme palettes
    // pick up a wallpaper-derived hue). Optionally cycles through the
    // full palette over time at frontSunPaletteSpeed — paletteCycle
    // is offset by +2 so at speed=0 it sits exactly on colorTertiary.
    float fpt = ubuf.iTime * 0.1 * ubuf.frontSunPaletteSpeed;
    // Average flip phase across front suns (weighted by per-pixel
    // reach), used to blend front-sun colour from current → next
    // palette as the wave sweeps through the suns' positions.
    float frontFlipNorm = (frontFlipWeight > 0.001)
                        ? frontFlipBlend / frontFlipWeight
                        : 0.0;
    vec3 frontSunColor = mix(paletteCycle(fpt + 2.0),
                             paletteCycleNext(fpt + 2.0),
                             frontFlipNorm);
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
