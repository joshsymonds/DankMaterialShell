.pragma library

// Sun placement for chrome_hexrain.frag. Every pixel of a frame shares the
// same sun positions, so they are computed here once per frame and handed to
// the shader as per-slot uniforms (see HexrainEffect.qml) rather than
// re-derived by every fragment.
//
// The hash and noise are the shaders' own, in float32 (every intermediate
// through Math.fround, GLSL literals rounded the same way).

// Slots per category; the shader declares this many uniforms per category.
var SLOTS = 10;

// Per-category slot-id offsets: the same slot index in two categories hashes
// to a different trajectory.
var BACK_ID = 7;
var FAST_BACK_ID = 401;
var BACK_NEG_ID = 101;
var FRONT_ID = 211;
var FRONT_NEG_ID = 307;

var f = Math.fround;

var K_HASH_X = f(123.34);
var K_HASH_Y = f(456.21);
var K_HASH_D = f(45.32);
var K_SLOT_PHASE_Y = f(7.3);
var K_FADE_IN = f(0.08);
var K_FADE_OUT = f(0.92);
var K_MIN_LIFETIME = f(0.001);
var K_MIN_PERIOD = f(0.05);
var K_MARGIN = f(0.18);

function fract(x) {
    return f(x - Math.floor(x));
}

function clamp(x, lo, hi) {
    return Math.min(Math.max(x, lo), hi);
}

function mix(a, b, t) {
    return f(f(a * f(1 - t)) + f(b * t));
}

function smoothstep(e0, e1, x) {
    const t = clamp(f(f(x - e0) / f(e1 - e0)), 0, 1);
    return f(f(t * t) * f(3 - f(2 * t)));
}

function hash(x, y) {
    let px = fract(f(x * K_HASH_X));
    let py = fract(f(y * K_HASH_Y));
    const d = f(f(px * f(px + K_HASH_D)) + f(py * f(py + K_HASH_D)));
    px = f(px + d);
    py = f(py + d);
    return fract(f(px * py));
}

function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = fract(x);
    let fy = fract(y);
    fx = f(f(fx * fx) * f(3 - f(2 * fx)));
    fy = f(f(fy * fy) * f(3 - f(2 * fy)));
    return mix(mix(hash(ix, iy), hash(f(ix + 1), iy), fx),
               mix(hash(ix, f(iy + 1)), hash(f(ix + 1), f(iy + 1)), fx),
               fy);
}

// One sun appearance cycle: fade in at a hashed point, wander a 2D noise path
// for `lifetime` seconds, fade out, then sit dark for (up to) `gap` seconds
// before the slot respawns somewhere new. `cycles` counts appearance cycles
// elapsed for the slot's category and `wander` how far along the noise path
// it has drifted (see advance()), so lifetime, gap and speed can change
// without the sun jumping.
//
// Returns [x, y, activeMask, appearanceHash]: virtual-canvas position, 0..1
// visibility (smooth fade at the ends), and a per-appearance hash the shader
// uses to pick palette phase.
function placement(slotId, lifetime, gap, cycles, wander, resX, resY) {
    const period = Math.max(f(lifetime + gap), K_MIN_PERIOD);
    const seedX = f(f(slotId * 41) + 17);
    // Per-slot phase (fraction of a cycle) so slots don't spawn together.
    const cyclePos = cycles - hash(seedX, K_SLOT_PHASE_Y);
    const cycleIdx = Math.floor(cyclePos);
    const cycleT = f((cyclePos - cycleIdx) * period);

    const seedY = f(f(cycleIdx * 31) + 5);

    const startDelay = f(hash(seedX, f(seedY + 23)) * gap);
    const life = f(cycleT - startDelay);
    const fInLife = clamp(f(life / Math.max(lifetime, K_MIN_LIFETIME)), 0, 1);
    const alive = (life >= 0 && lifetime >= life) ? 1 : 0;
    const fade = f(smoothstep(0, K_FADE_IN, fInLife) * smoothstep(1, K_FADE_OUT, fInLife));
    const activeMask = f(alive * fade);

    const ox = f(hash(f(seedX + 7), seedY) * 100);
    const oy = f(hash(seedX, f(seedY + 7)) * 100);

    const drift = f(wander);
    const wx = noise(f(drift + ox), f(f(slotId * 13) + 11));
    const wy = noise(f(drift + oy), f(f(slotId * 13) + 91));

    const x = f(resX * mix(-K_MARGIN, f(1 + K_MARGIN), wx));
    const y = f(resY * mix(-K_MARGIN, f(1 + K_MARGIN), wy));

    return [x, y, activeMask, hash(f(seedX + 41), f(seedY + 17))];
}

// Slots a (possibly fractional) count touches: the last one fades in with
// the fraction, so a count tweened from 4 to 5 brings the fifth sun in
// smoothly instead of popping it.
function slotCount(count) {
    return Math.min(SLOTS, Math.max(0, Math.ceil(count - 1e-6)));
}

function category(baseId, count, lifetime, gap, clock, resX, resY) {
    const n = slotCount(count);
    const out = [];
    for (let s = 0; s < SLOTS; s++) {
        if (s >= n) {
            out.push([0, 0, 0, 0]);
            continue;
        }
        const p = placement(f(s + baseId), f(lifetime), f(gap), clock.cycles, clock.wander, resX, resY);
        p[2] = f(p[2] * clamp(count - s, 0, 1));
        out.push(p);
    }
    return out;
}

function emptySlots() {
    const out = [];
    for (let s = 0; s < SLOTS; s++)
        out.push([0, 0, 0, 0]);
    return out;
}

// A field with every sun inactive, for effects running another shader.
function empty() {
    return {
        back: emptySlots(),
        fastBack: [0, 0, 0, 0],
        backNeg: emptySlots(),
        front: emptySlots(),
        frontNeg: emptySlots()
    };
}

// Sun categories by uniform prefix.
var CATEGORIES = ["backSun", "fastBackSun", "backNegSun", "frontSun", "frontNegSun"];

// Clocks for every rate-driven motion in chrome_hexrain, each advanced by
// rate × Δt so changing a rate (a slider, or a scene tween across a flip)
// changes speed from that moment on. Computing phase as time × rate instead
// would jump every phase when the rate moves, since time is large.
//   height, tilt          scale bob / tilt drift (heightDriftSpeed,
//                         tiltDriftSpeed)
//   backPalette,          sun palette cycling (backSunPaletteSpeed,
//   frontPalette          frontSunPaletteSpeed)
//   <category>.cycles     appearance cycles: sunDriftSpeed / (lifetime + gap)
//   <category>.wander     noise-path travel: sunDriftSpeed × speed
//
// `prev` is the previous frame's clocks (null to start). A backwards or
// multi-second jump in iTime restarts the clocks at time × rate.
function advance(prev, u) {
    const t = u.iTime;
    const dt = prev ? t - prev.time : -1;
    const restart = !(dt >= 0 && dt <= 5);
    const span = restart ? t : dt;
    const base = restart ? null : prev;
    const k = {
        time: t,
        height: (base ? base.height : 0) + span * u.heightDriftSpeed,
        tilt: (base ? base.tilt : 0) + span * u.tiltDriftSpeed,
        backPalette: (base ? base.backPalette : 0) + span * u.backSunPaletteSpeed,
        frontPalette: (base ? base.frontPalette : 0) + span * u.frontSunPaletteSpeed
    };
    for (const c of CATEGORIES) {
        const period = Math.max(u[c + "Lifetime"] + u[c + "Gap"], K_MIN_PERIOD);
        k[c] = {
            cycles: (base ? base[c].cycles : 0) + span * u.sunDriftSpeed / period,
            wander: (base ? base[c].wander : 0) + span * u.sunDriftSpeed * u[c + "Speed"]
        };
    }
    return k;
}

// Every sun placement for one frame. `u` carries the shader's uniform values
// by name (a HexrainEffect, or any object with the same properties); `clocks`
// comes from advance().
function field(u, clocks) {
    const resX = f(u.iResolution.x);
    const resY = f(u.iResolution.y);
    return {
        back: category(BACK_ID, u.backSunCount, u.backSunLifetime, u.backSunGap, clocks.backSun, resX, resY),
        fastBack: placement(FAST_BACK_ID, f(u.fastBackSunLifetime), f(u.fastBackSunGap),
                            clocks.fastBackSun.cycles, clocks.fastBackSun.wander, resX, resY),
        backNeg: category(BACK_NEG_ID, u.backNegSunCount, u.backNegSunLifetime, u.backNegSunGap, clocks.backNegSun, resX, resY),
        front: category(FRONT_ID, u.frontSunCount, u.frontSunLifetime, u.frontSunGap, clocks.frontSun, resX, resY),
        frontNeg: category(FRONT_NEG_ID, u.frontNegSunCount, u.frontNegSunLifetime, u.frontNegSunGap, clocks.frontNegSun, resX, resY)
    };
}
