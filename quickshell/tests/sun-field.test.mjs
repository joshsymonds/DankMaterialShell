import assert from "node:assert/strict";
import test from "node:test";
import { loadScript } from "./qml-script.mjs";

const sunField = loadScript(new URL("../Common/SunField.js", import.meta.url));

const RES = { x: 5120, y: 1440 };

function uniforms(overrides = {}) {
    return {
        iTime: 1000,
        sunDriftSpeed: 1.8,
        heightDriftSpeed: 0.75, tiltDriftSpeed: 0.5,
        backSunPaletteSpeed: 0.84, frontSunPaletteSpeed: 0.5,
        iResolution: RES,
        backSunCount: 4, backSunLifetime: 50, backSunGap: 15, backSunSpeed: 0.015,
        fastBackSunLifetime: 26, fastBackSunGap: 37, fastBackSunSpeed: 0.145,
        backNegSunCount: 4, backNegSunLifetime: 35, backNegSunGap: 18, backNegSunSpeed: 0.02,
        frontSunCount: 4, frontSunLifetime: 45, frontSunGap: 12, frontSunSpeed: 0.02,
        frontNegSunCount: 4, frontNegSunLifetime: 30, frontNegSunGap: 15, frontNegSunSpeed: 0.025,
        ...overrides
    };
}

const CATEGORIES = ["back", "backNeg", "front", "frontNeg"];

// One frame's field, with clocks started fresh at u.iTime.
function fieldAt(u) {
    return sunField.field(u, sunField.advance(null, u));
}

test("every category has SLOTS slots of four numbers", () => {
    const field = fieldAt(uniforms());
    for (const cat of CATEGORIES) {
        assert.equal(field[cat].length, sunField.SLOTS);
        for (const slot of field[cat]) assert.equal(slot.length, 4);
    }
    assert.equal(field.fastBack.length, 4);
});

test("slots at or beyond the category count are zero", () => {
    const field = fieldAt(uniforms({ backSunCount: 2, frontNegSunCount: 0 }));
    for (let s = 2; s < sunField.SLOTS; s++) assert.deepEqual([...field.back[s]], [0, 0, 0, 0]);
    for (const slot of field.frontNeg) assert.deepEqual([...slot], [0, 0, 0, 0]);
});

test("fractional counts touch the partial slot, cap at SLOTS", () => {
    assert.equal(sunField.slotCount(2), 2);
    assert.equal(sunField.slotCount(2.3), 3);
    assert.equal(sunField.slotCount(-1), 0);
    assert.equal(sunField.slotCount(40), sunField.SLOTS);
});

test("a fractional count fades the partial sun by its fraction", () => {
    const whole = fieldAt(uniforms({ backSunCount: 5 }));
    const partial = fieldAt(uniforms({ backSunCount: 4.25 }));
    assert.deepEqual([...partial.back[3]], [...whole.back[3]]);
    assert.ok(Math.abs(partial.back[4][2] - whole.back[4][2] * 0.25) < 1e-6);
});

test("clocks restart at time x rate and then integrate", () => {
    const u = uniforms();
    const k0 = sunField.advance(null, u);
    assert.ok(Math.abs(k0.height - 1000 * 0.75) < 1e-9);
    const k1 = sunField.advance(k0, uniforms({ iTime: 1000.5, heightDriftSpeed: 2 }));
    assert.ok(Math.abs(k1.height - (750 + 0.5 * 2)) < 1e-9);
    // A backwards jump restarts.
    const k2 = sunField.advance(k1, uniforms({ iTime: 10 }));
    assert.ok(Math.abs(k2.height - 10 * 0.75) < 1e-9);
});

test("changing a rate between frames never makes a sun jump", () => {
    let u = uniforms();
    let clocks = sunField.advance(null, u);
    let prev = sunField.field(u, clocks);
    for (let f = 1; f <= 120; f++) {
        // Tween every sun rate hard across two seconds of frames.
        const t = f / 60;
        u = uniforms({ iTime: 1000 + t, sunDriftSpeed: 1.8 - 0.9 * t / 2, backSunSpeed: 0.015 + 0.03 * t / 2,
                       backSunLifetime: 50 - 20 * t / 2, backSunGap: 15 - 7 * t / 2 });
        clocks = sunField.advance(clocks, u);
        const cur = sunField.field(u, clocks);
        for (let s = 0; s < 4; s++) {
            const [x0, y0, m0] = prev.back[s];
            const [x1, y1, m1] = cur.back[s];
            // A visible sun moves only by its slow wander between frames.
            if (m0 > 0.05 && m1 > 0.05)
                assert.ok(Math.hypot(x1 - x0, y1 - y0) < 40, `slot ${s} jumped ${Math.hypot(x1 - x0, y1 - y0)}px at frame ${f}`);
        }
        prev = cur;
    }
});

test("positions stay within the canvas plus the 18% wander margin", () => {
    for (let i = 0; i < 400; i++) {
        const field = fieldAt(uniforms({ iTime: i * 7.3 }));
        for (const cat of CATEGORIES) {
            for (const [x, y, mask, hash] of field[cat].slice(0, 4)) {
                assert.ok(x >= -0.18 * RES.x - 1 && x <= 1.18 * RES.x + 1, `x ${x}`);
                assert.ok(y >= -0.18 * RES.y - 1 && y <= 1.18 * RES.y + 1, `y ${y}`);
                assert.ok(mask >= 0 && mask <= 1, `mask ${mask}`);
                assert.ok(hash >= 0 && hash < 1, `hash ${hash}`);
            }
        }
    }
});

test("a slot alternates between visible appearances and dark gaps", () => {
    let visible = 0;
    let dark = 0;
    for (let i = 0; i < 500; i++) {
        const [, , mask] = fieldAt(uniforms({ iTime: i })).back[0];
        if (mask > 0.5) visible++;
        else if (mask === 0) dark++;
    }
    assert.ok(visible > 0, "never visible");
    assert.ok(dark > 0, "never dark");
});

test("placement is deterministic for a given time", () => {
    assert.deepEqual(fieldAt(uniforms()), fieldAt(uniforms()));
});

test("empty() is a field with every sun inactive", () => {
    const field = sunField.empty();
    for (const cat of CATEGORIES) {
        assert.equal(field[cat].length, sunField.SLOTS);
        for (const slot of field[cat]) assert.deepEqual([...slot], [0, 0, 0, 0]);
    }
    assert.deepEqual([...field.fastBack], [0, 0, 0, 0]);
});
