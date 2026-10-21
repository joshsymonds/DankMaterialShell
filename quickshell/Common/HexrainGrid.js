.pragma library

// Texture geometry for chrome_hexrain's pre-passes (layouts are documented
// in chrome_hexrain_cells.frag and chrome_hexrain_light.frag).

// Cells of margin around the canvas so neighbours of edge cells are in range.
var GRID_MARGIN = 2;

// Cell-pass texels per cell: 6 edge buckets, 2 of neighbour height
// differences, the scale's orientation, its pose, and its neighbours' reach.
var CELL_TEXELS = 11;

// Light-pass blocks, each covering the whole canvas: underglow + front reach,
// front colour + darkness, dominant front-light direction.
var LIGHT_BLOCKS = 3;

// Canvas pixels per light-pass texel. The sun field's narrowest gaussians are
// hundreds of pixels wide, so bilinear sampling at this pitch is visually
// exact.
var LIGHT_TEXEL_PX = 32;

function grid(cellSize, resX, resY) {
    const i = Math.max(1, cellSize);
    const pitchX = 2 * i;
    const pitchY = 1.7320508 * i;
    return {
        cols: Math.ceil(Math.max(resX, 0) / pitchX) + 2 * GRID_MARGIN + 1,
        rows: Math.ceil(Math.max(resY, 0) / pitchY) + 2 * GRID_MARGIN + 1,
        margin: GRID_MARGIN,
        cellTexels: CELL_TEXELS,
        lightCols: Math.ceil(Math.max(resX, 0) / LIGHT_TEXEL_PX) + 1,
        lightRows: Math.ceil(Math.max(resY, 0) / LIGHT_TEXEL_PX) + 1,
        lightTexelPx: LIGHT_TEXEL_PX,
        lightBlocks: LIGHT_BLOCKS
    };
}
