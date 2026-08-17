import type { MoveDef, MoveId } from './types';

export const MOVES: Record<MoveId, MoveDef> = {
  charge: { id: 'charge', name: '爆V', cost: 0, kind: 'buff', needsTarget: false, desc: '为自己 +1V；会被一切伤害招打中（究极打不中你）' },
  shield: { id: 'shield', name: '普通盾', cost: 0, kind: 'shield', needsTarget: false, desc: '挡住普通冲击波' },
  flyUp: { id: 'flyUp', name: '上天', cost: 0, kind: 'stance', needsTarget: false, desc: '本回合飞天：躲开一切单体攻击' },
  burrow: { id: 'burrow', name: '下地', cost: 0, kind: 'stance', needsTarget: false, desc: '本回合遁地：躲开一切单体攻击' },
  shock: { id: 'shock', name: '普通冲击波', cost: 1, kind: 'single', needsTarget: true, desc: '单体伤害；打不中飞天/遁地，被盾挡' },
  hammerSky: { id: 'hammerSky', name: '锤天', cost: 1, kind: 'aoe', needsTarget: false, desc: '攻击全部飞天者' },
  hammerGround: { id: 'hammerGround', name: '锤地', cost: 1, kind: 'aoe', needsTarget: false, desc: '攻击全部遁地者' },
  superShock: { id: 'superShock', name: '超级冲击波', cost: 2, kind: 'single', needsTarget: true, desc: '单体伤害；穿透普通盾；可伤锤天/锤地/扭曲虚空者' },
  superShield: { id: 'superShield', name: '超级盾', cost: 1, kind: 'shield', needsTarget: false, desc: '挡住任意冲击波（普/超/究极）' },
  hammerBoth: { id: 'hammerBoth', name: '锤天锤地', cost: 2, kind: 'aoe', needsTarget: false, desc: '攻击全部飞天+遁地+魔爆者' },
  finger: { id: 'finger', name: '一阳指', cost: 2, kind: 'single', needsTarget: true, desc: '单体伤害；无视一切盾；可伤锤天锤地者' },
  magicBurst: { id: 'magicBurst', name: '魔爆术', cost: 2, kind: 'counter', needsTarget: false, desc: '取消全部冲击波（含究极）并反伤其使用者' },
  voidRift: { id: 'voidRift', name: '扭曲虚空', cost: 2, kind: 'counter', needsTarget: false, desc: '取消全部一阳指并反伤其使用者' },
  ultimate: { id: 'ultimate', name: '究极冲击波', cost: 3, kind: 'aoe', needsTarget: false, desc: '攻击全部飞天/遁地/锤天/锤地/低级冲击波/普通盾/扭曲虚空者；打不中爆V者' },
};

/** 出招面板展示顺序（按消耗分档） */
export const MOVE_ORDER: MoveId[] = [
  'charge', 'shield', 'flyUp', 'burrow',
  'shock', 'hammerSky', 'hammerGround', 'superShield',
  'superShock', 'hammerBoth', 'finger', 'magicBurst', 'voidRift',
  'ultimate',
];
