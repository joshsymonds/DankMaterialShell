import assert from "node:assert/strict";
import test from "node:test";
import { loadScript } from "./qml-script.mjs";

const hexrainGrid = loadScript(new URL("../Common/HexrainGrid.js", import.meta.url));

// Lattice index of the cell owning canvas pixel (x, y), using the main
// pass's tiling (odd rows shifted half a pitch), plus its six neighbours.
function cellsTouched(x, y, cellSize) {
    const i = Math.max(1, cellSize);
    const pitchX = 2 * i;
    const pitchY = 1.7320508 * i;
    const out = [];
    for (const row of [Math.floor(y / pitchY), Math.floor(y / pitchY) + 1]) {
        const xOff = ((row % 2) + 2) % 2 === 0 ? 0 : pitchX / 2;
        const col = Math.floor((x - xOff) / pitchX + 0.5);
        for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
            out.push([col + dc, row + dr]);
    }
    return out;
}

test("the cell grid covers every pixel's cell and neighbours", () => {
    for (const [cellSize, resX, resY] of [[29, 5120, 1440], [14, 2560, 48], [8, 1920, 1080], [60, 640, 480]]) {
        const g = hexrainGrid.grid(cellSize, resX, resY);
        for (const x of [0, 0.5, resX / 3, resX - 0.5, resX]) {
            for (const y of [0, 0.5, resY / 2, resY - 0.5, resY]) {
                for (const [col, row] of cellsTouched(x, y, cellSize)) {
                    assert.ok(col + g.margin >= 0 && col + g.margin < g.cols, `col ${col} of ${g.cols} (${cellSize}, ${resX})`);
                    assert.ok(row + g.margin >= 0 && row + g.margin < g.rows, `row ${row} of ${g.rows} (${cellSize}, ${resY})`);
                }
            }
        }
    }
});

test("the light grid's texel centres span the canvas", () => {
    for (const [resX, resY] of [[5120, 1440], [2560, 48], [1, 1]]) {
        const g = hexrainGrid.grid(29, resX, resY);
        assert.ok((g.lightCols - 0.5) * g.lightTexelPx >= resX, `lightCols ${g.lightCols} for ${resX}`);
        assert.ok((g.lightRows - 0.5) * g.lightTexelPx >= resY, `lightRows ${g.lightRows} for ${resY}`);
    }
});

test("degenerate sizes still produce a usable grid", () => {
    const g = hexrainGrid.grid(0, 0, 0);
    assert.ok(g.cols >= 1 && g.rows >= 1 && g.lightCols >= 1 && g.lightRows >= 1);
    assert.equal(g.cellTexels, 10);
    assert.equal(g.lightBlocks, 3);
});
