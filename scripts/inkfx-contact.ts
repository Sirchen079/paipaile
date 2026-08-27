import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
const FILES = ['01_爆V','02_普通盾','03_上天','04_下地','05_普通冲击波','06_锤天','07_锤地','08_超级盾','09_超级冲击波','10_锤天锤地','11_一阳指','12_魔爆术','13_扭曲虚空','14_究极冲击波'];
const SRC = '拍拍乐水墨特效素材包/水墨技能特效/';
const CW = 340, CH = 260, COLS = 4, ROWS = 4, PAD = 34;
const composites: OverlayOptions[] = [];
for (let i = 0; i < FILES.length; i++) {
  const buf = await sharp(SRC + FILES[i] + '.png').resize({ width: CW - 20, height: CH - 20, fit: 'inside' }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  const x = (i % COLS) * CW + (CW - (meta.width ?? 0)) / 2;
  const y = Math.floor(i / COLS) * CH + PAD + (CH - PAD - (meta.height ?? 0)) / 2;
  composites.push({ input: buf, left: Math.round(x), top: Math.round(y) });
  const label = Buffer.from(`<svg width="${CW}" height="${PAD}"><text x="8" y="24" font-size="20" fill="#333" font-family="sans-serif">${FILES[i]}</text></svg>`);
  composites.push({ input: label, left: (i % COLS) * CW, top: Math.floor(i / COLS) * CH });
}
await sharp({ create: { width: CW * COLS, height: CH * ROWS, channels: 4, background: '#f5f0e6' } })
  .composite(composites).png({ quality: 80 }).toFile('tmp/inkfx-contact.png');
console.log('done');
