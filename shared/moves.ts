import type { MoveDef, MoveId } from './types';

export interface MoveMeta extends MoveDef {
  /** 主题色（结算演出/UI 高亮） */
  color: string;
  /** 斗法氛围短句（结算演出时的“吟唱”） */
  flavor: string;
}

export const MOVES: Record<MoveId, MoveMeta> = {
  charge:     { id: 'charge', name: '爆V', cost: 0, kind: 'buff', needsTarget: false, color: '#ffd54a', flavor: '气沉丹田，周天贯通', desc: '为自己 +1V；会被一切伤害招打中（究极打不中你）' },
  shield:     { id: 'shield', name: '普通盾', cost: 0, kind: 'shield', needsTarget: false, color: '#4ad7ff', flavor: '万法不侵', desc: '挡住普通冲击波' },
  flyUp:      { id: 'flyUp', name: '上天', cost: 0, kind: 'stance', needsTarget: false, color: '#7ee9ff', flavor: '扶摇直上九万里', desc: '本回合飞天：躲开一切单体攻击' },
  burrow:     { id: 'burrow', name: '下地', cost: 0, kind: 'stance', needsTarget: false, color: '#c9a35e', flavor: '土行孙在此', desc: '本回合遁地：躲开一切单体攻击' },
  shock:      { id: 'shock', name: '普通冲击波', cost: 1, kind: 'single', needsTarget: true, color: '#b06cff', flavor: '五雷正法！', desc: '单体伤害；打不中飞天/遁地，被盾挡' },
  hammerSky:  { id: 'hammerSky', name: '锤天', cost: 1, kind: 'aoe', needsTarget: false, color: '#ff8a3c', flavor: '天地玄黄，镇压昊天', desc: '攻击全部飞天者' },
  hammerGround:{ id: 'hammerGround', name: '锤地', cost: 1, kind: 'aoe', needsTarget: false, color: '#ff6b4a', flavor: '崩山裂地，地脉寸断', desc: '攻击全部遁地者' },
  superShield:{ id: 'superShield', name: '超级盾', cost: 1, kind: 'shield', needsTarget: false, color: '#ffe082', flavor: '金刚不坏，法身不灭', desc: '挡住任意冲击波（普/超/究极）' },
  superShock: { id: 'superShock', name: '超级冲击波', cost: 2, kind: 'single', needsTarget: true, color: '#c05cff', flavor: '紫霄神雷，荡涤群魔', desc: '单体伤害；穿透普通盾；可伤锤天/锤地/扭曲虚空者' },
  hammerBoth: { id: 'hammerBoth', name: '锤天锤地', cost: 2, kind: 'aoe', needsTarget: false, color: '#ff5470', flavor: '天地同力，日月无光', desc: '攻击全部飞天+遁地+魔爆者' },
  finger:     { id: 'finger', name: '一阳指', cost: 2, kind: 'single', needsTarget: true, color: '#ffd700', flavor: '一指定乾坤', desc: '单体伤害；无视一切盾；可伤锤天锤地者' },
  magicBurst: { id: 'magicBurst', name: '魔爆术', cost: 2, kind: 'counter', needsTarget: false, color: '#a03cff', flavor: '群魔乱舞，噬尽神通', desc: '取消全部冲击波（含究极）并反伤其使用者' },
  voidRift:   { id: 'voidRift', name: '扭曲虚空', cost: 2, kind: 'counter', needsTarget: false, color: '#4a6cff', flavor: '虚空塌陷，万物归墟', desc: '取消全部一阳指并反伤其使用者' },
  ultimate:   { id: 'ultimate', name: '究极冲击波', cost: 3, kind: 'aoe', needsTarget: false, color: '#ff2d55', flavor: '吾以道证万古！', desc: '攻击全部飞天/遁地/锤天/锤地/低级冲击波/普通盾/扭曲虚空者；打不中爆V者' },
};

/** 出招面板展示顺序（按消耗分档） */
export const MOVE_ORDER: MoveId[] = [
  'charge', 'shield', 'flyUp', 'burrow',
  'shock', 'hammerSky', 'hammerGround', 'superShield',
  'superShock', 'hammerBoth', 'finger', 'magicBurst', 'voidRift',
  'ultimate',
];

/** 每档消耗的展示名 */
export const COST_LABEL = ['免费招', '消耗 1V', '消耗 2V', '消耗 3V'] as const;
