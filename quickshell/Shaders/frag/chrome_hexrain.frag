#version 450

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// Main pass of the hexrain wallpaper. Two pre-passes feed it each frame
// (wired up by quickshell/Widgets/HexrainEffect.qml):
//   cellTex  — chrome_hexrain_cells.frag: per-cell data (2D stream
//              activations per edge, height differences to the neighbours,
//              each scale's orientation and pose), sampled with nearest
//              filtering.
//   lightTex — chrome_hexrain_light.frag: the smooth sun field on a coarse
//              grid (three blocks), sampled bilinearly.
//
// The field is a layer of thin hexagonal scales floating over a glowing
// underlayer, seen through a perspective camera hung cameraDistance px
// above the centre of the virtual canvas, looking straight down. Each
// scale has its own height, tilt and flip rotation (cell pass); this pass
// casts a ray per pixel against the scale under it and, near edges, its
// neighbours, then shades the nearest hit: domed matte faces with grain,
// rounded rims, key light with the scales' drop shadows, front-sun light,
// and the underglow: streaming out over a scale wherever a neighbour
// floats high enough above it to leave an opening, the seam beside it
// glowing to match. Rays that miss every scale show the underglow through
// the gap.
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
    // modeAmount=0 = the flat 2D matrix-rain look (bar surfaces);
    // modeAmount=1 = the 3D scale field.
    float modeAmount;
    float domeStrength;    // 0..1 — multiplier on the underglow lip glow
    float seamGlow;        // 0..3 — underglow brightness (gaps, leak, rims)
    float seamBase;        // 0..1 — glow through a gap between level
                           //         neighbours, relative to a full step
    float heightAmount;    // 0..1 — brightness of underglow streaming out
                           //         over a scale through an opening
    float matteness;       // 0..1 — surface "light friction". Low =
                           //         streaming light reaches far across
                           //         a face; high = absorbed quickly.
    float hexBevel;        // 0..1 — width of the gap between scales (at
                           //         0.25 a sub-pixel hairline)
    // ── Scales ───────────────────────────────────────────────────
    float heightRange;     // px — scale heights span ±heightRange
    float tiltMax;         // rad — largest tilt a scale drifts to
    float slabThickness;   // px — scale thickness (edge-on during a flip)
    float domeHeight;      // px — how far each face bulges at its centre
    float cameraDistance;  // px — camera height above the canvas; larger
                           //      = flatter perspective
    float grainScale;      // 1/px — matte grain frequency (≤ 0.4)
    float grainStrength;   // 0..2 — grain relief
    float rimGlow;         // 0..3 — underglow caught by scale rims
    float keyLight;        // 0..2 — soft light from the upper left that
                           //         always shapes the scales (domes,
                           //         tilt, grain), suns or not
    float scaleShadow;     // 0..1 — key-light shadows scales cast onto
                           //         lower neighbours
    float occlusion;       // 0..1 — darkening of scales sitting low in the
                           //         height range
    // Front suns: localised spotlights (reach, colour and direction from
    // the light pass).
    float frontSunStrength;       // 0..N — brightness of each spotlight.
    // ── Palette flip wave ────────────────────────────────────────
    // A wave radiates from (flipOriginX, flipOriginY): each scale turns
    // over (cell pass) to show its underside in the staged Next palette
    // as the wave reaches it, the suns' colours switch as it reaches
    // them, and the 2D layer's palette blends. At idle, flipStartTime
    // sits far in the future (e.g. 1e9) so nothing has turned.
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
    // so tiling, scales and suns all live in one shared space even when
    // split across outputs.
    vec4 windowGeom;
    // Pre-pass texture geometry (see the pass shaders for layouts).
    float gridCols;
    float gridRows;
    float gridMargin;
    float gridCellTexels;
    float lightCols;
    float lightRows;
    float lightTexelPx;
    // Bar zone (elevation applied in the cell pass); here only to bound
    // how far raised bar scales can reach by parallax.
    float barZoneEnabled;
    float barZoneElevation;
} ubuf;

layout(binding = 1) uniform sampler2D cellTex;
layout(binding = 2) uniform sampler2D lightTex;

const float PI3 = 1.04719755;        // π / 3
const float TWO_PI = 6.28318531;

// Key light: a soft fixed light from the upper left, about 45° up
// (unit vector toward the light; screen y runs down).
const vec3 KEY_DIR = vec3(-0.45113, -0.55138, 0.70175);

// Px over which a face fades into the seam glow at an edge where light
// pours out of the gap (scaled by that opening). The glow is what the
// gap shows, so there the face's edge and the gap meet at the same
// colour and the bright seam can't alias; level edges get no fade band,
// just the gap's antialiased hairline.
const float HALO_PX = 1.0;

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

// Light-pass block b (0..2) at canvas position p.
vec4 lightAt(vec2 p, float b) {
    vec2 uv = clamp(p / ubuf.lightTexelPx,
                    vec2(0.5), vec2(ubuf.lightCols, ubuf.lightRows) - 0.5);
    return texture(lightTex, vec2((uv.x + b * ubuf.lightCols) / (ubuf.lightCols * 3.0),
                                  uv.y / ubuf.lightRows));
}

// Centre of the cell at lattice index `cell` (odd rows shifted half a pitch).
vec2 latticeCenter(vec2 cell, float pitchX, float pitchY) {
    return vec2(cell.x * pitchX + mod(cell.y, 2.0) * pitchX * 0.5, cell.y * pitchY);
}

// Lattice index of neighbour k (angle k·60°). Odd rows sit half a pitch
// right, so the column step of the four diagonal neighbours depends on
// the row's parity.
vec2 neighbourIdx(vec2 cell, int k) {
    float odd = mod(cell.y, 2.0);
    if (k == 0) return cell + vec2(1.0, 0.0);
    if (k == 1) return cell + vec2(odd, 1.0);
    if (k == 2) return cell + vec2(odd - 1.0, 1.0);
    if (k == 3) return cell + vec2(-1.0, 0.0);
    if (k == 4) return cell + vec2(odd - 1.0, -1.0);
    return cell + vec2(odd, -1.0);
}

// Largest projection of p onto the three hex edge normals: p is inside a
// hex of inradius a when this is below a.
float hexExtent(vec2 p) {
    return max(abs(p.x), max(abs(dot(p, vec2(0.5, 0.8660254))),
                             abs(dot(p, vec2(-0.5, 0.8660254)))));
}

// Exact fraction of a unit pixel on the inner side of a straight edge
// whose unit normal is n, with the pixel centre `t` px inside it (box
// filter): linear across the middle, quadratic where the pixel's
// corners cross.
float edgeCoverage(float t, vec2 n) {
    float a = max(abs(n.x), abs(n.y));
    float b = min(abs(n.x), abs(n.y));
    float reach = 0.5 * (a + b);
    if (t >= reach) return 1.0;
    if (t <= -reach) return 0.0;
    if (abs(t) <= 0.5 * (a - b)) return 0.5 + t / a;
    float s = reach - abs(t);
    float corner = s * s / (2.0 * a * b);
    return t > 0.0 ? 1.0 - corner : corner;
}

// How much of the unit pixel centred at local point p a hex face of
// inradius a covers, judged against its nearest edge.
float hexCoverage(vec2 p, float a) {
    float e0 = abs(p.x);
    float e1 = abs(dot(p, vec2(0.5, 0.8660254)));
    float e2 = abs(dot(p, vec2(-0.5, 0.8660254)));
    float extent = max(e0, max(e1, e2));
    vec2 normal = (e0 >= e1 && e0 >= e2) ? vec2(1.0, 0.0) : vec2(0.5, 0.8660254);
    return edgeCoverage(a - extent, normal);
}

vec3 rotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

// Matte grain: value-noise relief, one octave so its finest detail
// stays above a pixel (grainScale is capped below Nyquist) and it doesn't
// shimmer as the scales move.
float grainRelief(vec2 u) {
    return noise(u);
}

// Nearest scale hit along the current ray.
struct Hit {
    float t;        // ray distance (1e30 = none)
    vec2 cell;      // lattice index
    vec4 q;         // orientation (scale-local → world)
    vec4 pose;      // height, flip angle, flip axis
    vec3 p;         // hit point, scale-local
    float face;     // 0 = top/bottom, 1..3 = side pair k-1
    float side;     // +1 = top / +n side, -1 = bottom / -n side
};

// Ray (ro, rd) against the scale of `cell`: a hexagonal slab of inradius
// `apothem` and half-thickness `halfT` (edges facing the six neighbour
// directions), centred on its cell lifted by its height and oriented by
// its quaternion. A scale at rest is tested by its top face alone: its
// tilted rim would show only as sub-pixel slivers. A turning scale is
// tested as the full slab (slab method over the z pair and three edge
// pairs), so its rim shows as it goes edge-on. Keeps the two nearest
// hits in `best` and `next`.
void testScale(vec2 cell, vec3 ro, vec3 rd, float pitchX, float pitchY,
               float apothem, float halfT, inout Hit best, inout Hit next) {
    vec4 q = cellTexel(cell, 8.0);
    vec4 pose = cellTexel(cell, 9.0);
    vec4 qInv = vec4(-q.xyz, q.w);
    vec3 o = rotate(qInv, ro - vec3(latticeCenter(cell, pitchX, pitchY), pose.x));
    vec3 d = rotate(qInv, rd);
    float dz = abs(d.z) > 1e-6 ? d.z : (d.z < 0.0 ? -1e-6 : 1e-6);

    float t;
    float face = 0.0;
    float side = d.z < 0.0 ? 1.0 : -1.0;
    if (pose.y < 0.02) {
        t = (side * halfT - o.z) / dz;
        if (!(t > 0.0) || hexExtent(o.xy + d.xy * t) > apothem)
            return;
    } else {
        float z0 = (-halfT - o.z) / dz;
        float z1 = (halfT - o.z) / dz;
        t = min(z0, z1);
        float tFar = max(z0, z1);
        for (int k = 0; k < 3; k++) {
            float ang = float(k) * PI3;
            vec2 n = vec2(cos(ang), sin(ang));
            float dn = dot(d.xy, n);
            dn = abs(dn) > 1e-6 ? dn : (dn < 0.0 ? -1e-6 : 1e-6);
            float on = dot(o.xy, n);
            float t0 = (-apothem - on) / dn;
            float t1 = (apothem - on) / dn;
            float tn = min(t0, t1);
            if (tn > t) {
                t = tn;
                face = float(k + 1);
                side = dn < 0.0 ? 1.0 : -1.0;
            }
            tFar = min(tFar, max(t0, t1));
        }
        if (!(t <= tFar && t > 0.0))
            return;
    }
    Hit hit = Hit(t, cell, q, pose, o + d * t, face, side);
    if (t < best.t) {
        next = best;
        best = hit;
    } else if (t < next.t) {
        next = hit;
    }
}

// Strength of the light streaming out through an opening of `opening` px
// between one scale's top and a neighbour's bottom (0 when closed).
float openingLight(float opening, float halfT) {
    return smoothstep(0.0, 2.0 * halfT + 2.0, opening);
}

// Height of neighbour k (angle k·60°) of scale `cell` minus the scale's
// own, in px (cell pass).
float edgeDelta(vec2 cell, float k) {
    vec4 d = cellTexel(cell, k < 3.5 ? 6.0 : 7.0);
    float j = k < 3.5 ? k : k - 4.0;
    return j < 0.5 ? d.x : j < 1.5 ? d.y : j < 2.5 ? d.z : d.w;
}

// How much of the key light the neighbours of scale `cell` block at
// `point` on it (0..1). The light comes from the upper left and shadows
// run at most ~20 px, so only the three neighbours toward the light
// (k = 3, 4, 5: left, upper left, upper right) can cast onto it. A
// neighbour that floats clear of this scale leaves an opening the
// underglow pours out of, brightening this scale along that edge, so its
// shadow gives way to that light as the opening widens: at any edge it's
// light from below or a shadow, never both.
// Each scale is treated as a flat hex at its top; the shadow test walks
// from the point toward the light up to that height and checks the hex
// there, with a penumbra that widens with the height difference. A
// turning scale's footprint narrows across its flip axis, so its shadow
// thins to nothing edge-on.
float keyShadow(vec3 point, vec2 cell, float pitchX, float pitchY,
                float apothem, float halfT) {
    float shadow = 0.0;
    for (int k = 3; k < 6; k++) {
        float open = openingLight(edgeDelta(cell, float(k)) - 2.0 * halfT, halfT);
        if (open >= 1.0) continue;
        vec2 c = neighbourIdx(cell, k);
        vec4 pose = cellTexel(c, 9.0);
        // Height difference only: the dome is shading curvature, and a
        // scale's rim (what shades its neighbour) sits at its flat top.
        float rise = pose.x + halfT - point.z;
        if (rise <= 0.5) continue;
        vec2 q = point.xy + KEY_DIR.xy * (rise / KEY_DIR.z) - latticeCenter(c, pitchX, pitchY);
        vec2 axis = pose.zw;
        vec2 across = vec2(-axis.y, axis.x);
        q = axis * dot(q, axis) + across * (dot(q, across) / max(abs(cos(pose.y)), 0.05));
        float penumbra = 0.6 + rise * 0.12;
        shadow = max(shadow, smoothstep(-penumbra, penumbra, apothem - hexExtent(q)) * (1.0 - open));
    }
    return shadow;
}

// How open the gap beside local point p of scale `cell` is (0..1, see
// openingLight), from the two edges nearest p. Toward the corner between
// them the more open edge carries through, fading over 2 px: light from
// an open gap spills into the junction and a dim seam begins past it,
// rather than the dim seam eating into the end of the lit one.
float edgeOpening(vec2 cell, vec2 p, float halfT) {
    float d0 = -1e9, d1 = -1e9;
    float k0 = 0.0, k1 = 0.0;
    for (int k = 0; k < 6; k++) {
        float ang = float(k) * PI3;
        float d = dot(p, vec2(cos(ang), sin(ang)));
        if (d > d0) {
            d1 = d0; k1 = k0;
            d0 = d; k0 = float(k);
        } else if (d > d1) {
            d1 = d; k1 = float(k);
        }
    }
    float open0 = openingLight(abs(edgeDelta(cell, k0)) - 2.0 * halfT, halfT);
    float open1 = openingLight(abs(edgeDelta(cell, k1)) - 2.0 * halfT, halfT);
    return max(open0, open1 * (1.0 - smoothstep(0.0, 2.0, d0 - d1)));
}

// The glowing underlayer seen through a gap `opening` open (edgeOpening). It lies below every scale (heightRange + 6 px under the canvas
// plane), so parallax shifts it like real depth. How much of it escapes
// follows the gap: a little always (seamBase), and fully where one scale
// floats clear of the other and the light streams out — the same opening
// that lights the lower scale's face, so a bright seam always comes with
// light on the scale beside it (and no shadow from that neighbour there;
// see keyShadow).
vec3 underlayer(vec3 ro, vec3 rd, float opening) {
    float z = -(ubuf.heightRange + 6.0);
    vec3 point = ro + rd * ((z - ro.z) / rd.z);
    float escape = mix(ubuf.seamBase, 1.0, opening);
    return lightAt(point.xy, 0.0).rgb * ubuf.seamGlow * escape;
}

// Shade a scale hit.
vec3 shadeScale(Hit hit, vec3 ro, vec3 rd, float i, float pitchX, float pitchY,
                float apothem, float halfT) {
    vec3 world = ro + rd * hit.t;
    vec4 lightA = lightAt(world.xy, 0.0);   // underglow, front reach
    vec4 lightB = lightAt(world.xy, 1.0);   // front colour, front darkness
    vec3 frontDir = lightAt(world.xy, 2.0).xyz;
    vec3 underglow = lightA.rgb;

    // Face coordinates. The underside is the top mirrored across the
    // flip axis, so after a half-turn it lands exactly where the top
    // was: committing the palette after a flip changes nothing on screen.
    vec2 flipAxis = hit.pose.zw;
    vec2 faceXY = hit.side > 0.0 ? hit.p.xy
                                 : 2.0 * dot(hit.p.xy, flipAxis) * flipAxis - hit.p.xy;

    vec3 normal;
    vec3 tint;
    float albedo = 1.0;
    float leak = 0.0;
    float lit = 0.0;      // how much light streams in here, 0..1
    float depthShade = 1.0;
    if (hit.face < 0.5) {
        // Domed face: z = ±(halfT + domeHeight·(1 − r²/apothem²)).
        vec3 nl = vec3(2.0 * ubuf.domeHeight * hit.p.xy / (apothem * apothem), hit.side);

        // Matte grain in face coordinates, seeded per scale: a fine, soft
        // relief that tilts the normal so grazing light picks out the
        // finish, with only a faint albedo variation following it.
        if (ubuf.grainStrength > 0.0) {
            vec2 u = faceXY * min(ubuf.grainScale, 0.4) + hit.cell * 17.31;
            float e = 0.35;
            float g0 = grainRelief(u);
            vec2 grad = vec2(grainRelief(u + vec2(e, 0.0)) - g0,
                             grainRelief(u + vec2(0.0, e)) - g0) / e;
            nl.xy -= grad * ubuf.grainStrength * min(ubuf.grainScale, 0.4) * 0.8 * hit.side;
            albedo = 1.0 + (g0 - 0.5) * 0.25 * min(ubuf.grainStrength, 2.0);
        }
        normal = rotate(hit.q, normalize(nl));
        tint = hit.side > 0.0 ? ubuf.colorPrimaryContainer.rgb
                              : ubuf.colorPrimaryContainerNext.rgb;

        // Underglow at each edge, by the opening to that neighbour: the
        // gap between its bottom and this face's top (both slabs are
        // 2·halfT thick). An open window lets light rising through the
        // gap stream out over this face — brighter and further the wider
        // it is, fading over the matte. A neighbour that doesn't clear
        // this face (or a level or lower one) lets none through, so that
        // edge stays unlit; actual shadows come only from the key light.
        float reachScale = mix(1.6, 0.35, ubuf.matteness);
        float stream = 0.0;
        for (int k = 0; k < 6; k++) {
            float opening = edgeDelta(hit.cell, float(k)) - 2.0 * halfT;
            if (opening > 0.0) {
                float ang = float(k) * PI3;
                float distIn = max(0.0, apothem - dot(faceXY, vec2(cos(ang), sin(ang))));
                stream += openingLight(opening, halfT) * exp(-distIn / ((2.0 + opening * 1.5) * reachScale));
            }
        }
        leak = clamp(stream * ubuf.heightAmount, 0.0, 1.0) * ubuf.domeStrength;
        lit = clamp(stream * 2.0, 0.0, 1.0);
        // Depth: less light overall the lower the scale sits in its
        // height range.
        float lowness = clamp(0.5 - hit.pose.x / max(ubuf.heightRange, 0.001) * 0.5, 0.0, 1.0);
        depthShade = 1.0 - ubuf.occlusion * 0.45 * lowness;

    } else {
        // Rim: the edge face, rounded toward the top and bottom so it
        // catches light along its length.
        float ang = (hit.face - 1.0) * PI3;
        vec3 nl = vec3(vec2(cos(ang), sin(ang)) * hit.side, hit.p.z / halfT * 0.8);
        normal = rotate(hit.q, normalize(nl));
        tint = mix(ubuf.colorPrimaryContainer.rgb, ubuf.colorPrimaryContainerNext.rgb, 0.5) * 0.8;
    }

    // Front suns: matte (wrapped Lambert) light from the dominant front
    // direction, gated by reach.
    float lambert = max(0.0, (dot(normal, frontDir) + 0.1) / 1.1);
    vec3 front = lightB.rgb * ubuf.frontSunStrength * 0.6 * lightA.a * lambert;

    // Key light: so every scale's dome, tilt and grain read even outside
    // the suns' reach. Taller neighbours shadow it — except where light
    // from below streams in, which fills the shadow back in: a shadow
    // never reaches a lit edge.
    float keyLambert = max(0.0, (dot(normal, KEY_DIR) + 0.1) / 1.1);
    float shadow = ubuf.scaleShadow * (1.0 - lit)
                 * keyShadow(world, hit.cell, pitchX, pitchY, apothem, halfT);

    // Body: the matte tint under ambient + key light, plus front light,
    // all modulated by grain, depth and shadow, then eaten by front-
    // negative suns. Underglow arrives as the lip leak on faces and along
    // rims facing sideways or down.
    vec3 body = (tint * (0.55 * (1.0 - 0.35 * shadow) + ubuf.keyLight * 1.6 * keyLambert * (1.0 - shadow))
                 + front * (1.0 - 0.6 * shadow))
              * albedo * depthShade * (1.0 - lightB.a);
    vec3 glow = underglow * ubuf.seamGlow
              * (leak
                 + ubuf.rimGlow * (1.0 - abs(normal.z)) * (hit.face < 0.5 ? 0.0 : 1.0)
                 + max(-normal.z, 0.0) * ubuf.rimGlow);
    vec3 color = body + glow;
    if (hit.face < 0.5) {
        float pour = edgeOpening(hit.cell, faceXY, halfT);
        if (pour > 0.0)
            color = mix(color, underlayer(ro, rd, pour),
                        pour * (1.0 - smoothstep(0.0, HALO_PX, apothem - hexExtent(hit.p.xy))));
    }
    return color;
}

// A cheap stand-in for a scale covering the lesser part of an edge pixel
// shared with another scale: its matte tint under ambient and key light,
// sunk by its depth and taken as partly shadowed.
vec3 standInScale(Hit hit, vec3 ro, vec3 rd, float i, float apothem, float halfT) {
    vec3 tint = hit.side > 0.0 ? ubuf.colorPrimaryContainer.rgb : ubuf.colorPrimaryContainerNext.rgb;
    float lowness = clamp(0.5 - hit.pose.x / max(ubuf.heightRange, 0.001) * 0.5, 0.0, 1.0);
    vec3 body = tint * (0.55 + ubuf.keyLight * 0.8)
              * (1.0 - ubuf.occlusion * 0.45 * lowness) * (1.0 - 0.35 * ubuf.scaleShadow);
    // Near an opening it is lit like the full shading would light it:
    // light streaming in from the edge, the seam colour at the edge.
    float pour = edgeOpening(hit.cell, hit.p.xy, halfT);
    if (pour <= 0.0)
        return body;
    float distIn = max(apothem - hexExtent(hit.p.xy), 0.0);
    vec3 seam = underlayer(ro, rd, pour);
    float reach = (2.0 + 3.0 * halfT) * mix(1.6, 0.35, ubuf.matteness);
    body += underlayer(ro, rd, 1.0) * pour * exp(-distIn / reach)
          * ubuf.heightAmount * ubuf.domeStrength;
    return mix(body, seam, pour * (1.0 - smoothstep(0.0, HALO_PX, distIn)));
}

// Colour of the 3D scale field at canvas pixel px. One ray, tested
// against scales grown by AA_PX so the pixels just outside an outline
// still find the face; its coverage of the pixel (from the distance to
// the true outline) blends it over what the ray meets next — the scale
// behind, or the underglow through the gap. That antialiases both sides
// of every outline, gaps and overlaps alike.
vec3 scaleField(vec2 px, float i, float pitchX, float pitchY) {
    const float AA_PX = 0.75;
    float seamWidth = max(0.1, ubuf.hexBevel * i * 0.04);
    float apothem = i - seamWidth;
    float halfT = max(ubuf.slabThickness, 0.1) * 0.5;

    // The flat-tiling cell under px: the scale under it before parallax.
    float row0 = floor(px.y / pitchY);
    vec2 c0 = vec2(floor((px.x - mod(row0, 2.0) * pitchX * 0.5) / pitchX + 0.5), row0);
    vec2 c1 = vec2(floor((px.x - mod(row0 + 1.0, 2.0) * pitchX * 0.5) / pitchX + 0.5), row0 + 1.0);
    vec2 d0 = px - latticeCenter(c0, pitchX, pitchY);
    vec2 d1 = px - latticeCenter(c1, pitchX, pitchY);
    bool nearRow0 = dot(d0, d0) < dot(d1, d1);
    vec2 cellIdx = nearRow0 ? c0 : c1;
    vec2 local = nearRow0 ? d0 : d1;

    float camDist = max(ubuf.cameraDistance, 100.0);
    vec3 ro = vec3(ubuf.iResolution.xy * 0.5, camDist);
    vec3 rd = normalize(vec3(px, 0.0) - ro);

    // Scales only reach past their own cell by parallax (height × offset
    // from the camera axis / camera distance, the tallest being raised
    // bar-zone scales with a tilted rim) and, while turning over, by
    // their thickness and dome; neighbours are tested only where px lies
    // within that margin of the shared edge.
    float barLift = ubuf.barZoneEnabled > 0.5 ? max(ubuf.barZoneElevation, 0.0) : 0.0;
    float lift = ubuf.heightRange * (1.0 + barLift) + halfT + ubuf.domeHeight
               + apothem * sin(ubuf.tiltMax);
    bool turning = ubuf.iTime > ubuf.flipStartTime;
    float margin = lift * (length(px - ro.xy) + apothem) / max(camDist - lift, 1.0)
                 + (turning ? halfT + ubuf.domeHeight : 0.0) + 1.0 + AA_PX;

    Hit hit = Hit(1e30, vec2(0.0), vec4(0.0), vec4(0.0), vec3(0.0), 0.0, 0.0);
    Hit behind = hit;
    testScale(cellIdx, ro, rd, pitchX, pitchY, apothem + AA_PX, halfT, hit, behind);
    for (int k = 0; k < 6; k++) {
        float ang = float(k) * PI3;
        if (i - dot(local, vec2(cos(ang), sin(ang))) < margin)
            testScale(neighbourIdx(cellIdx, k), ro, rd, pitchX, pitchY, apothem + AA_PX, halfT, hit, behind);
    }

    // Through the gaps: the underglow itself, as much as the gap beside
    // the nearest edge lets out.
    float gapOpening = edgeOpening(cellIdx, local, halfT);
    if (hit.t > 1e29)
        return underlayer(ro, rd, gapOpening);

    // How much of the pixel each surface covers: the front scale its own
    // share, the next scale up to what the front leaves (scales either
    // side of a gap cover separate parts of the pixel; one overlapping
    // another by parallax shows only where the front one doesn't), and
    // the underglow in the gap whatever remains.
    float coverage = hit.face < 0.5 ? hexCoverage(hit.p.xy, apothem) : 1.0;
    if (coverage >= 1.0)
        return shadeScale(hit, ro, rd, i, pitchX, pitchY, apothem, halfT);
    float behindCoverage = behind.t < 1e29 && behind.face < 0.5
        ? min(hexCoverage(behind.p.xy, apothem), 1.0 - coverage) : 0.0;

    // The surface covering more of the pixel gets the full shading, the
    // other the cheap stand-in: a front scale found only through the
    // antialiasing margin mustn't push the scale actually filling the
    // pixel down to the stand-in.
    Hit main = hit;
    Hit other = behind;
    float mainCoverage = coverage;
    float otherCoverage = behindCoverage;
    if (behindCoverage > coverage) {
        main = behind;
        other = hit;
        mainCoverage = behindCoverage;
        otherCoverage = coverage;
    }
    vec3 color = shadeScale(main, ro, rd, i, pitchX, pitchY, apothem, halfT) * mainCoverage;
    if (otherCoverage > 0.0)
        color += standInScale(other, ro, rd, i, apothem, halfT) * otherCoverage;
    float gap = 1.0 - coverage - behindCoverage;
    if (gap > 0.0)
        color += underlayer(ro, rd, gapOpening) * gap;
    return color;
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

    // ── 3D scale field ────────────────────────────────────────────
    vec3 color3D = scaleField(px, i, pitchX, pitchY);

    // ── Mix 2D and 3D looks ────────────────────────────────────────
    vec3 finalColor = mix(finalColor2D, color3D, ubuf.modeAmount);
    float a = mix(alpha2D, 1.0, ubuf.modeAmount);

    fragColor = vec4(finalColor * ubuf.intensity * ubuf.qt_Opacity,
                     a * ubuf.intensity * ubuf.qt_Opacity);
}
