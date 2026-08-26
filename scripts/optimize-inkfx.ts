/**
 * 压缩水墨技能特效素材：素材包 PNG（每张 0.5~2.3MB，共 ~20MB）→ WebP（目标合计 <3MB）
 * 输入：拍拍乐水墨特效素材包/水墨技能特效/*.png
 * 输出：web/public/inkfx/{moveId}.webp（按招式 ID 重命名，ASCII 文件名免编码问题）
 * 用法: npx tsx scripts/optimize-inkfx.ts
 */
import sharp from 'sharp';
import { readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../拍拍乐水墨特效素材包/水墨技能特效');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../web/public/inkfx');

/** 素材文件名序号 → 招式 ID */
const MOVE_MAP: Record<string, string> = {
  '01': 'charge',        // 爆V
  '02': 'shield',        // 普通盾
  '03': 'flyUp',         // 上天
  '04': 'burrow',        // 下地
  '05': 'shock',         // 普通冲击波
  '06': 'hammerSky',     // 锤天
  '07': 'hammerGround',  // 锤地
  '08': 'superShield',   // 超级盾
  '09': 'superShock',    // 超级冲击波
  '10': 'hammerBoth',    // 锤天锤地
  '11': 'finger',        // 一阳指
  '12': 'magicBurst',    // 魔爆术
  '13': 'voidRift',      // 扭曲虚空
  '14': 'ultimate',      // 究极冲击波
};

mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.png'));
if (files.length === 0) {
  console.error(`未在 ${SRC} 找到 PNG 素材`);
  process.exit(1);
}

let inTotal = 0, outTotal = 0;
for (const f of files) {
  const num = parse(f).name.slice(0, 2);
  const move = MOVE_MAP[num];
  if (!move) {
    console.warn(`跳过未映射文件：${f}`);
    continue;
  }
  const src = join(SRC, f);
  const out = join(OUT, `${move}.webp`);
  const meta = await sharp(src).metadata();
  await sharp(src)
    .webp({ quality: 85, effort: 4, smartSubsample: true })
    .toFile(out);
  const i = statSync(src).size, o = statSync(out).size;
  inTotal += i; outTotal += o;
  console.log(`${f} (${meta.width}×${meta.height}) → ${move}.webp  ${(i / 1048576).toFixed(2)}MB → ${(o / 1024).toFixed(0)}KB`);
}
console.log(`\n合计：${(inTotal / 1048576).toFixed(1)}MB → ${(outTotal / 1048576).toFixed(2)}MB`);

// 校验 14 招全齐
const missing = Object.values(MOVE_MAP).filter((m) => !existsSync(join(OUT, `${m}.webp`)));
if (missing.length) {
  console.error(`缺失：${missing.join(', ')}`);
  process.exit(1);
}
console.log('14 招素材齐备 ✓');
