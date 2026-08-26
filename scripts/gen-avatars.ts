/**
 * 程序化生成修真立绘头像：金色轮廓剪影 + 墨色底 + 法器
 * 4 款可选：剑修 / 道尊 / 魔尊 / 仙子
 * 每款输出两版：
 *   {file}.svg     卡片版（墨色底+名字），用于首页选择器和大厅
 *   {file}-raw.svg 斗法版（透明底无文字，人物撑满），用于 Pixi 斗法场
 * 用法: npx tsx scripts/gen-avatars.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../web/public/avatars');
mkdirSync(OUT, { recursive: true });

interface AvatarSpec {
  file: string;
  name: string;
  aura: string;      // 光晕色
  accent: string;    // 描边/法器色
  robe1: string;     // 袍色渐变上
  robe2: string;     // 袍色渐变下
  body: string;      // 人物剪影 path
  prop: string;      // 法器 path
}

// 统一的修真人物剪影（宽肩袍袖 + 发髻），在此基础上叠加法器区分角色
const ROBE = 'M60 190 Q40 160 45 120 Q48 90 60 78 Q52 60 60 45 Q68 30 78 30 Q88 30 96 45 Q104 60 96 78 Q108 90 111 120 Q116 160 96 190 Z';
const XIANZI_BODY = 'M60 190 Q42 165 47 125 Q50 95 62 82 Q56 62 64 48 Q72 34 78 34 Q84 34 92 48 Q100 62 94 82 Q106 95 109 125 Q114 165 96 190 Z';

const AVATARS: AvatarSpec[] = [
  {
    file: 'jianxiu', name: '剑修', aura: '#4ae3ff', accent: '#f2c44f',
    robe1: '#e8ecff', robe2: '#8a94c0', // 月白
    body: ROBE,
    prop: 'M78 95 L78 55 M78 95 L70 80 M78 95 L86 80', // 背后长剑
  },
  {
    file: 'daozun', name: '道尊', aura: '#f2c44f', accent: '#ffe082',
    robe1: '#fff3d6', robe2: '#d9a94e', // 暖金白
    body: ROBE,
    prop: 'M60 55 Q78 40 96 55 M78 55 L78 42', // 浮尘/太极冠
  },
  {
    file: 'mozun', name: '魔尊', aura: '#a86bff', accent: '#ff3d5e',
    robe1: '#b79cff', robe2: '#3d2470', // 紫黑
    body: ROBE,
    prop: 'M52 60 L45 45 M104 60 L111 45 M60 52 L52 42 M96 52 L104 42', // 魔角+魔气
  },
  {
    file: 'xianzi', name: '仙子', aura: '#ff9ec6', accent: '#4ae3ff',
    robe1: '#ffe6f2', robe2: '#d98ab5', // 粉白
    body: XIANZI_BODY,
    prop: 'M55 100 Q78 130 101 100 M78 115 L78 145', // 飘带
  },
];

const defs = (spec: AvatarSpec) => `
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#1b2650"/>
      <stop offset="55%" stop-color="#0d1226"/>
      <stop offset="100%" stop-color="#070a16"/>
    </radialGradient>
    <radialGradient id="aura" cx="50%" cy="46%" r="50%">
      <stop offset="0%" stop-color="${spec.aura}" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="${spec.aura}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${spec.aura}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${spec.robe1}"/>
      <stop offset="100%" stop-color="${spec.robe2}"/>
    </linearGradient>
  </defs>`;

const figure = (spec: AvatarSpec, auraR = 62) => `
  <circle cx="78" cy="92" r="${auraR}" fill="url(#aura)"/>
  <g stroke="${spec.accent}" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.95">
    <path d="${spec.prop}"/>
  </g>
  <path d="${spec.body}" fill="url(#robe)" stroke="${spec.accent}" stroke-width="2" opacity="0.96"/>
  <circle cx="78" cy="58" r="16" fill="url(#robe)" stroke="${spec.accent}" stroke-width="2"/>
  <path d="M62 52 Q78 34 94 52" fill="none" stroke="${spec.accent}" stroke-width="2"/>`;

/** 卡片版：墨色底 + 名字，用于选择器/大厅 */
function cardSvg(spec: AvatarSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 156 200" width="156" height="200">${defs(spec)}
  <rect width="156" height="200" rx="18" fill="url(#bg)"/>${figure(spec)}
  <text x="78" y="182" text-anchor="middle" font-family="Ma Shan Zheng, KaiTi, serif" font-size="22" fill="${spec.accent}" letter-spacing="2">${spec.name}</text>
</svg>`;
}

/** 斗法版：透明底、无文字，viewBox 收紧让人物撑满，用于 Pixi 斗法场 */
function rawSvg(spec: AvatarSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="34 22 88 172" width="88" height="172">${defs(spec)}${figure(spec, 44)}
</svg>`;
}

for (const a of AVATARS) {
  writeFileSync(join(OUT, `${a.file}.svg`), cardSvg(a), 'utf8');
  writeFileSync(join(OUT, `${a.file}-raw.svg`), rawSvg(a), 'utf8');
}
console.log(`已生成 ${AVATARS.length * 2} 个立绘（卡片版+斗法版）: ${AVATARS.map((a) => a.name).join('、')} → ${OUT}`);
