/**
 * 计算水墨特效图的视觉锚点数据（客观像素统计，供 arena.ts 定位用）：
 * - centroid: alpha 加权质心（墨迹主体中心），单位为画布宽高百分比
 * - bbox: alpha>24 的包围盒（内容占画布的范围）
 * - core: 朱砂红核心质心（r>g+40 且 r>b+40 的像素），无则回退质心
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const MOVES: [string, string][] = [
  ['charge', '01_爆V'], ['shield', '02_普通盾'], ['flyUp', '03_上天'], ['burrow', '04_下地'],
  ['shock', '05_普通冲击波'], ['hammerSky', '06_锤天'], ['hammerGround', '07_锤地'],
  ['superShield', '08_超级盾'], ['superShock', '09_超级冲击波'], ['hammerBoth', '10_锤天锤地'],
  ['finger', '11_一阳指'], ['magicBurst', '12_魔爆术'], ['voidRift', '13_扭曲虚空'], ['ultimate', '14_究极冲击波'],
];
const SRC = '拍拍乐水墨特效素材包/水墨技能特效/';
const out: Record<string, { w: number; h: number; centroid: [number, number]; bbox: [number, number, number, number]; core: [number, number] }> = {};

for (const [id, file] of MOVES) {
  const { data, info } = await sharp(SRC + file + '.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let mSum = 0, mx = 0, my = 0;
  let rSum = 0, rx = 0, ry = 0;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const a = data[i + 3];
      if (a <= 24) continue;
      const fx = x / info.width, fy = y / info.height;
      mSum += a; mx += fx * a; my += fy * a;
      if (fx < x0) x0 = fx; if (fx > x1) x1 = fx;
      if (fy < y0) y0 = fy; if (fy > y1) y1 = fy;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 120 && r > g + 40 && r > b + 40) { rSum += a; rx += fx * a; ry += fy * a; }
    }
  }
  out[id] = {
    w: info.width, h: info.height,
    centroid: [+(mx / mSum).toFixed(3), +(my / mSum).toFixed(3)],
    bbox: [+x0.toFixed(3), +y0.toFixed(3), +x1.toFixed(3), +y1.toFixed(3)],
    core: rSum > 0 ? [+(rx / rSum).toFixed(3), +(ry / rSum).toFixed(3)] : [+(mx / mSum).toFixed(3), +(my / mSum).toFixed(3)],
  };
}
writeFileSync('shared/fxAnchors.json', JSON.stringify(out, null, 2));
console.table(Object.entries(out).map(([id, v]) => ({ id, size: `${v.w}x${v.h}`, cx: v.centroid[0], cy: v.centroid[1], coreX: v.core[0], coreY: v.core[1], bbox: v.bbox.join(',') })));
