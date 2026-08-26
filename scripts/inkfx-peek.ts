import sharp from 'sharp';
const SRC = '拍拍乐水墨特效素材包/水墨技能特效/';
const FILES: [string, string][] = [
  ['06_锤天', 'h06'], ['07_锤地', 'h07'], ['10_锤天锤地', 'h10'],
  ['05_普通冲击波', 's05'], ['14_究极冲击波', 's14'], ['12_魔爆术', 'm12'],
];
for (const [f, out] of FILES) {
  await sharp(SRC + f + '.png').resize({ width: 420 }).png().toFile(`tmp/peek/${out}.png`);
}
console.log('done');
