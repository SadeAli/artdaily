'use strict';
/* Adversarial suite for box-check's pure scorer. Extracts the PURE
   section of box-check/js/game.js (between its own banner comments) into
   a vm and asserts the two guards the 2026-08-23 launch review earned:
   a pencil of near-parallel hatch strokes is never paid as a box (on any
   visit — the first-visit mercy does not apply to it), and the left/right
   critique labels follow each converging family's actual vanishing-point
   side, not the line-slope heuristic that swapped them on a full
   12-edge box. Plus the regressions: an honest box still scores like
   one at 6 and 12 edges. */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'box-check', 'js', 'game.js'), 'utf8');
const lines = src.split('\n');
const banners = [];
lines.forEach((l, i) => { if (l.includes('============')) banners.push(i); });
let head = lines.slice(banners[1] + 1, banners[2]).join('\n');
head = head.replace('(function () {', '').replace("'use strict';", '');
const pure = head + '\n' + lines.slice(banners[3] + 1, banners[4]).join('\n');
const sandbox = { Math, console, isFinite, Infinity };
vm.createContext(sandbox);
vm.runInContext(pure + '\n;__x = { analyzeBox, fitSegment };', sandbox);
const { analyzeBox, fitSegment } = sandbox.__x;

function seg(x1, y1, x2, y2, rng, jitterDeg) {
  if (jitterDeg) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const r = (rng() - 0.5) * 2 * jitterDeg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const rot = ([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
    [x1, y1] = rot([x1, y1]); [x2, y2] = rot([x2, y2]);
  }
  const n = 24, pts = [];
  for (let i = 0; i <= n; i++) pts.push({ x: x1 + (x2 - x1) * i / n, y: y1 + (y2 - y1) * i / n });
  return fitSegment(pts);
}
function lcg(s0) { let s = s0 >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) fails++; };

/* 1 — nine near-parallel hatch strokes must not pass, on ANY visit */
for (const sd of [1, 2, 3, 4, 5]) {
  const rng = lcg(sd);
  const segs = [];
  for (let i = 0; i < 9; i++) {
    const x = 60 + rng() * 380, y = 60 + rng() * 260;
    const L = 120 + rng() * 60, ang = 35 * Math.PI / 180;
    segs.push(seg(x, y, x + L * Math.cos(ang), y + L * Math.sin(ang), rng, 2.5));
  }
  const r1 = analyzeBox(segs, { easeMul: 2, capHard: false });
  const r2 = analyzeBox(segs, { easeMul: 2, capHard: true });
  ok(r1.notABox && r1.score <= 30, `seed ${sd}: hatch fan flagged + capped on a FIRST visit (score ${r1.score}, notABox ${r1.notABox})`);
  ok(r2.score <= 30, `seed ${sd}: and capped with capHard too (score ${r2.score})`);
}

/* 2 — full 12-edge two-VP box: labels must match the VP sides */
function xsect(p1, p2, p3, p4) {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}
function fullBox(VL, VR, fx, ftop, fbot, backT) {
  const toward = (p, v, t) => ({ x: p.x + (v.x - p.x) * t, y: p.y + (v.y - p.y) * t });
  const A = { x: fx, y: ftop }, B = { x: fx, y: fbot };
  const AR = toward(A, VR, backT), BR = toward(B, VR, backT);
  const AL = toward(A, VL, backT), BL = toward(B, VL, backT);
  /* the far corner sits where the two back edges truly cross, so every
     edge lies exactly on a VP line */
  const CT = xsect(AR, VL, AL, VR);
  const CB = xsect(BR, VL, BL, VR);
  const E = [];
  const add = (p, q) => E.push(seg(p.x, p.y, q.x, q.y));
  add(A, B); add(AR, BR); add(AL, BL); add(CT, CB);
  add(A, AR); add(B, BR); add(AL, CT); add(BL, CB);
  add(A, AL); add(B, BL); add(AR, CT); add(BR, CB);
  return E;
}
const VL = { x: 24, y: 171 }, VR = { x: 582, y: 171 };
const segs12 = fullBox(VL, VR, 300, 190, 300, 0.45);
const r = analyzeBox(segs12, { easeMul: 1, capHard: true });
const byKey = {}; r.families.forEach(f => { byKey[f.key] = f; });
ok(!!byKey.l && !!byKey.r && !!byKey.v, `12-edge box sorts into v/l/r rows (got ${r.families.map(f => f.key).join(',')})`);
if (byKey.l && byKey.r) {
  ok(byKey.l.vp && byKey.l.vp.x < r.cx, `left row's VP is on the left (vp.x ${byKey.l.vp && Math.round(byKey.l.vp.x)}, cx ${Math.round(r.cx)})`);
  ok(byKey.r.vp && byKey.r.vp.x > r.cx, `right row's VP is on the right (vp.x ${byKey.r.vp && Math.round(byKey.r.vp.x)}, cx ${Math.round(r.cx)})`);
}
ok(!r.notABox, `an honest full box is not flagged as a hatch fan (score ${r.score})`);
ok(r.score >= 70, `and still scores like a box (score ${r.score})`);

/* 3 — regression: a 6-edge honest box neither hatch-flagged nor crashed */
const segs6 = fullBox(VL, VR, 300, 190, 300, 0.45).slice(0, 6);
const r6 = analyzeBox(segs6, { easeMul: 2, capHard: true });
ok(!r6.notABox, `6-edge box not flagged (score ${r6.score})`);

console.log(fails ? fails + ' FAILURE(S)' : 'all green');
process.exit(fails ? 1 : 0);
