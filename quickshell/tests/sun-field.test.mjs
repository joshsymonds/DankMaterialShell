import assert from "node:assert/strict";
import test from "node:test";
import { loadScript } from "./qml-script.mjs";

const sunField = loadScript(new URL("../Common/SunField.js", import.meta.url));

const RES = { x: 5120, y: 1440 };

function uniforms(overrides = {}) {
    return {
        iTime: 1000,
        sunDriftSpeed: 1.8,
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

test("every category has SLOTS slots of four numbers", () => {
    const field = sunField.field(uniforms());
    for (const cat of CATEGORIES) {
        assert.equal(field[cat].length, sunField.SLOTS);
        for (const slot of field[cat]) assert.equal(slot.length, 4);
    }
    assert.equal(field.fastBack.length, 4);
});

test("slots at or beyond the category count are zero", () => {
    const field = sunField.field(uniforms({ backSunCount: 2, frontNegSunCount: 0 }));
    for (let s = 2; s < sunField.SLOTS; s++) assert.deepEqual([...field.back[s]], [0, 0, 0, 0]);
    for (const slot of field.frontNeg) assert.deepEqual([...slot], [0, 0, 0, 0]);
});

test("counts round like the shader's int(count + 0.5) and cap at SLOTS", () => {
    assert.equal(sunField.slotCount(2.4), 2);
    assert.equal(sunField.slotCount(2.5), 3);
    assert.equal(sunField.slotCount(-1), 0);
    assert.equal(sunField.slotCount(40), sunField.SLOTS);
});

test("positions stay within the canvas plus the 18% wander margin", () => {
    for (let i = 0; i < 400; i++) {
        const field = sunField.field(uniforms({ iTime: i * 7.3 }));
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
        const [, , mask] = sunField.field(uniforms({ iTime: i })).back[0];
        if (mask > 0.5) visible++;
        else if (mask === 0) dark++;
    }
    assert.ok(visible > 0, "never visible");
    assert.ok(dark > 0, "never dark");
});

test("placement is deterministic for a given time", () => {
    assert.deepEqual(sunField.field(uniforms()), sunField.field(uniforms()));
});

test("empty() is a field with every sun inactive", () => {
    const field = sunField.empty();
    for (const cat of CATEGORIES) {
        assert.equal(field[cat].length, sunField.SLOTS);
        for (const slot of field[cat]) assert.deepEqual([...slot], [0, 0, 0, 0]);
    }
    assert.deepEqual([...field.fastBack], [0, 0, 0, 0]);
});
