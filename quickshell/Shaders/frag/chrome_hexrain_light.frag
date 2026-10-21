#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// Light pass for chrome_hexrain.frag. Every sun is a gaussian hundreds to
// thousands of pixels wide, so the combined sun field is smooth enough to
// evaluate on a coarse grid (one texel per lightTexelPx canvas pixels) and
// bilinearly sample in the main pass. Only the front suns' hex-shaped cast
// shadows are sharp; those stay per-pixel in the main pass.
//
// The texture is two lightCols x lightRows halves side by side, both covering
// the whole virtual canvas (texel k centred on canvas pixel (k + 0.5) *
// lightTexelPx):
//   left  rgb = back-sun underglow after the hue cap and negative suns
//         a   = front-sun reach (summed, clamped)
//   right rgb = front-sun colour (palette, blended through the flip wave)
//         a   = front-negative-sun darkness
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float iTime;
    float cellSize;
    vec3 iResolution;
    vec4 colorPrimary;
    vec4 colorSecondary;
    vec4 colorTertiary;
    vec4 colorPrimaryNext;
    vec4 colorSecondaryNext;
    vec4 colorTertiaryNext;
    float frontSunSize;
    float backSunSize;
    float backSunStrength;
    float backNegSunSize;
    float backNegSunStrength;
    float backSunPaletteSpeed;
    float frontSunPaletteSpeed;
    float backSunCount;
    float backNegSunCount;
    float frontSunCount;
    float frontNegSunCount;
    float frontNegSunStrength;
    float frontNegSunSize;
    float fastBackSunStrength;
    float fastBackSunSize;
    float flipOriginX;
    float flipOriginY;
    float flipStartTime;
    float flipPropDelay;
    float flipDuration;
    float lightCols;
    float lightRows;
    float lightTexelPx;
    // Per-frame sun placements from quickshell/Common/SunField.js:
    // xy = virtual-canvas position, z = active mask 0..1, w = per-
    // appearance hash. Slots at or beyond a category's count are zero.
    vec4 backSun0; vec4 backSun1; vec4 backSun2; vec4 backSun3; vec4 backSun4;
    vec4 backSun5; vec4 backSun6; vec4 backSun7; vec4 backSun8; vec4 backSun9;
    vec4 fastBackSun;
    vec4 backNegSun0; vec4 backNegSun1; vec4 backNegSun2; vec4 backNegSun3; vec4 backNegSun4;
    vec4 backNegSun5; vec4 backNegSun6; vec4 backNegSun7; vec4 backNegSun8; vec4 backNegSun9;
    vec4 frontSun0; vec4 frontSun1; vec4 frontSun2; vec4 frontSun3; vec4 frontSun4;
    vec4 frontSun5; vec4 frontSun6; vec4 frontSun7; vec4 frontSun8; vec4 frontSun9;
    vec4 frontNegSun0; vec4 frontNegSun1; vec4 frontNegSun2; vec4 frontNegSun3; vec4 frontNegSun4;
    vec4 frontNegSun5; vec4 frontNegSun6; vec4 frontNegSun7; vec4 frontNegSun8; vec4 frontNegSun9;
} ubuf;

// Qt's ShaderEffect can't upload uniform arrays and GLSL ES 100 has no
// switch, so each category's slots are read through a plain if-chain.
vec4 backSunSlot(int s) {
    if (s == 0) return ubuf.backSun0;
    if (s == 1) return ubuf.backSun1;
    if (s == 2) return ubuf.backSun2;
    if (s == 3) return ubuf.backSun3;
    if (s == 4) return ubuf.backSun4;
    if (s == 5) return ubuf.backSun5;
    if (s == 6) return ubuf.backSun6;
    if (s == 7) return ubuf.backSun7;
    if (s == 8) return ubuf.backSun8;
    return ubuf.backSun9;
}

vec4 backNegSunSlot(int s) {
    if (s == 0) return ubuf.backNegSun0;
    if (s == 1) return ubuf.backNegSun1;
    if (s == 2) return ubuf.backNegSun2;
    if (s == 3) return ubuf.backNegSun3;
    if (s == 4) return ubuf.backNegSun4;
    if (s == 5) return ubuf.backNegSun5;
    if (s == 6) return ubuf.backNegSun6;
    if (s == 7) return ubuf.backNegSun7;
    if (s == 8) return ubuf.backNegSun8;
    return ubuf.backNegSun9;
}

vec4 frontSunSlot(int s) {
    if (s == 0) return ubuf.frontSun0;
    if (s == 1) return ubuf.frontSun1;
    if (s == 2) return ubuf.frontSun2;
    if (s == 3) return ubuf.frontSun3;
    if (s == 4) return ubuf.frontSun4;
    if (s == 5) return ubuf.frontSun5;
    if (s == 6) return ubuf.frontSun6;
    if (s == 7) return ubuf.frontSun7;
    if (s == 8) return ubuf.frontSun8;
    return ubuf.frontSun9;
}

vec4 frontNegSunSlot(int s) {
    if (s == 0) return ubuf.frontNegSun0;
    if (s == 1) return ubuf.frontNegSun1;
    if (s == 2) return ubuf.frontNegSun2;
    if (s == 3) return ubuf.frontNegSun3;
    if (s == 4) return ubuf.frontNegSun4;
    if (s == 5) return ubuf.frontNegSun5;
    if (s == 6) return ubuf.frontNegSun6;
    if (s == 7) return ubuf.frontNegSun7;
    if (s == 8) return ubuf.frontNegSun8;
    return ubuf.frontNegSun9;
}

// Smooth palette cycle: maps a continuous phase to a colour that
// morphs through primary → secondary → tertiary → primary as the
// phase walks 0 → 1 → 2 → 3.
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

// Same as paletteCycle but over the "Next" palette, for suns the flip
// wave has reached.
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

// Flip-wave phase at a world-space position (here, a sun's): hex steps
// from the origin delay the start; each position then walks 0 → 1 over
// flipDuration.
float positionFlipPhase(vec2 worldPos, float pitchY) {
    vec2 flipOrigin = vec2(ubuf.flipOriginX, ubuf.flipOriginY);
    float distFromOrigin = distance(worldPos, flipOrigin);
    float steps = distFromOrigin / max(pitchY, 1.0);
    return clamp(
        (ubuf.iTime - ubuf.flipStartTime - steps * ubuf.flipPropDelay) /
        max(ubuf.flipDuration, 0.001),
        0.0, 1.0);
}

// Back-sun underglow: N back suns plus the fast streak, hue-capped, then
// attenuated by the negative back suns.
vec3 underglow(vec2 px, float pitchY) {
    float canvasMax = max(ubuf.iResolution.x, ubuf.iResolution.y);

    float sigma = max(ubuf.backSunSize * canvasMax, 1.0);
    float invSig2 = 1.0 / (sigma * sigma);
    int nBackPos = int(ubuf.backSunCount + 0.5);
    float fnBackPos = max(float(nBackPos), 1.0);

    vec3 lightRaw = vec3(0.0);
    for (int s = 0; s < 10; s++) {
        if (s >= nBackPos) break;
        vec4 place = backSunSlot(s);
        vec2 sunPos = place.xy;
        float actMask = place.z;
        float colorHash = place.w;

        vec2 d = px - sunPos;
        float g = exp(-dot(d, d) * invSig2);
        // Per-slot colour distribution: each slot owns a 1/count slice
        // of the palette (so two slots can't pile onto the same hue at
        // spawn). colorHash dithers within that slice so the exact hue
        // varies appearance-to-appearance; per-sun rate variance
        // (0.6x..1.4x of backSunPaletteSpeed) lets neighbours drift past
        // each other only briefly.
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

    // Fast back sun: one streak with its own clock, layered over the
    // slow pool. Its strength applies after backSunStrength; it joins
    // lightRaw before the hue cap so overlap saturates gracefully.
    if (ubuf.fastBackSunStrength > 0.001) {
        vec4 fbPlace = ubuf.fastBackSun;
        float fbSigma = max(ubuf.fastBackSunSize * canvasMax, 1.0);
        float fbInvSig2 = 1.0 / (fbSigma * fbSigma);
        vec2 fbD = px - fbPlace.xy;
        float fbG = exp(-dot(fbD, fbD) * fbInvSig2);
        // Per-appearance random palette phase on the shared back-sun
        // palette clock.
        float fbPhase = ubuf.iTime * 0.1 * ubuf.backSunPaletteSpeed
                      + fbPlace.w * 3.0;
        float fbFlip = positionFlipPhase(fbPlace.xy, pitchY);
        vec3 fbCol = mix(paletteCycle(fbPhase),
                         paletteCycleNext(fbPhase),
                         fbFlip);
        lightRaw += fbCol * fbG * fbPlace.z * ubuf.fastBackSunStrength;
    }

    // Hue-preserving cap: overlapping saturated suns would otherwise
    // clip to neutral white; capping at the source keeps the field
    // coloured in whichever sun's hue dominates locally.
    float lightMax = max(lightRaw.r, max(lightRaw.g, lightRaw.b));
    vec3 lightFromSuns = lightRaw / max(lightMax, 1.0);

    // Negative back suns: anti-lights that attenuate whatever underglow
    // is there, as drifting dark patches.
    float negSunSigma = max(ubuf.backNegSunSize * canvasMax, 1.0);
    float negInvSig2 = 1.0 / (negSunSigma * negSunSigma);
    int nBackNeg = int(ubuf.backNegSunCount + 0.5);
    for (int s = 0; s < 10; s++) {
        if (s >= nBackNeg) break;
        vec4 place = backNegSunSlot(s);
        vec2 toNegSun = place.xy - px;
        float negSunReach = exp(-dot(toNegSun, toNegSun) * negInvSig2);
        float darkFactor = clamp(negSunReach * ubuf.backNegSunStrength * place.z,
                                 0.0, 0.98);
        lightFromSuns *= (1.0 - darkFactor);
    }
    return lightFromSuns;
}

void main() {
    float pitchY = 1.7320508 * max(1.0, ubuf.cellSize);
    float canvasMax = max(ubuf.iResolution.x, ubuf.iResolution.y);

    vec2 texel = floor(qt_TexCoord0 * vec2(ubuf.lightCols * 2.0, ubuf.lightRows));
    bool rightHalf = texel.x >= ubuf.lightCols;
    if (rightHalf) texel.x -= ubuf.lightCols;
    vec2 px = (texel + 0.5) * ubuf.lightTexelPx;

    float frontSunSigma = max(ubuf.frontSunSize * canvasMax * 0.5, 1.0);
    float frontInvSig2 = 1.0 / (frontSunSigma * frontSunSigma);
    int nFrontPos = int(ubuf.frontSunCount + 0.5);

    if (!rightHalf) {
        float frontSunReach = 0.0;
        for (int s = 0; s < 10; s++) {
            if (s >= nFrontPos) break;
            vec4 place = frontSunSlot(s);
            vec2 toSun = place.xy - px;
            frontSunReach += exp(-dot(toSun, toSun) * frontInvSig2) * place.z;
        }
        // Several suns can sum past 1; the front-sun hue is a single
        // colour, so saturating is the right behaviour.
        fragColor = vec4(underglow(px, pitchY), clamp(frontSunReach, 0.0, 1.0));
        return;
    }

    // Front-sun colour starts at colorTertiary (paletteCycle offset +2)
    // and optionally cycles at frontSunPaletteSpeed. During a flip it
    // blends to the Next palette by the reach-weighted average flip phase
    // of the front suns lighting this point.
    float frontFlipBlend = 0.0;
    float frontFlipWeight = 0.0;
    for (int s = 0; s < 10; s++) {
        if (s >= nFrontPos) break;
        vec4 place = frontSunSlot(s);
        vec2 toSun = place.xy - px;
        float pxReach = exp(-dot(toSun, toSun) * frontInvSig2) * place.z;
        frontFlipBlend  += positionFlipPhase(place.xy, pitchY) * pxReach;
        frontFlipWeight += pxReach;
    }
    float frontFlipNorm = (frontFlipWeight > 0.001)
                        ? frontFlipBlend / frontFlipWeight
                        : 0.0;
    float fpt = ubuf.iTime * 0.1 * ubuf.frontSunPaletteSpeed;
    vec3 frontSunColor = mix(paletteCycle(fpt + 2.0),
                             paletteCycleNext(fpt + 2.0),
                             frontFlipNorm);

    // Front-negative suns: anti-spots that darken bodies in their reach.
    // Strongest one wins (max, not sum) so overlaps can't pass the cap.
    float frontNegSigma = max(ubuf.frontNegSunSize * canvasMax * 0.5, 1.0);
    float frontNegInvSig2 = 1.0 / (frontNegSigma * frontNegSigma);
    int nFrontNeg = int(ubuf.frontNegSunCount + 0.5);
    float frontDarkness = 0.0;
    for (int s = 0; s < 10; s++) {
        if (s >= nFrontNeg) break;
        vec4 place = frontNegSunSlot(s);
        vec2 toNeg = place.xy - px;
        float reach = exp(-dot(toNeg, toNeg) * frontNegInvSig2) * place.z;
        frontDarkness = max(frontDarkness, reach * ubuf.frontNegSunStrength);
    }
    fragColor = vec4(frontSunColor, clamp(frontDarkness, 0.0, 0.98));
}
