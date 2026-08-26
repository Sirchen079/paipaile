/**
 * 演出节奏表：每个事件在斗法场里占用的展示时长（毫秒）
 * 前端 playRound 按它排事件间隔，服务端按它估算回合演出总时长（showMs），两边必须一致。
 * 原则：小招快节奏，大招有酝酿和余韵，命中/阵亡要定格看清。
 */
import type { GameEvent, MoveId } from './types';

/** 各招式 reveal 时的展示时长 */
const REVEAL_PACE: Record<MoveId, number> = {
  charge: 750,        // 爆V：光柱升腾
  shield: 850,        // 普通盾：盾面成形
  superShield: 950,   // 超级盾：双层金罩
  flyUp: 850,         // 上天：扶摇直上
  burrow: 850,        // 下地：遁地潜行
  shock: 1050,        // 普通冲击波：聚能→束流→爆点
  hammerSky: 1150,    // 锤天：天罚砸落
  hammerGround: 1150, // 锤地：地裂震荡
  superShock: 1900,   // 超级冲击波：聚能蓄势→朱砂弹道贯穿→命中(2V 档:看得清每一拍)
  hammerBoth: 2200,   // 锤天锤地：双锤合拢酝酿→天地合击暗拍→墨浪(2V 档)
  finger: 1800,       // 一阳指：凝指→光束贯通→束心白热(2V 档)
  magicBurst: 2000,   // 魔爆术：主爆→暗拍→二段余爆(2V 档)
  voidRift: 2200,     // 扭曲虚空：裂隙旋张吞噬→闭合崩断(2V 档)
  ultimate: 2600,     // 究极冲击波：题字→蓄力→屏息→墨龙→双闪爆发(3V 档,压住 2V)
};

/** 单个事件的展示时长 */
export function eventPaceMs(ev: GameEvent): number {
  switch (ev.type) {
    case 'reveal': return REVEAL_PACE[ev.move];
    case 'vChange': return 300;
    case 'stance': return 350;
    case 'hit': return ev.lethal ? 1300 : 750;
    case 'blocked': return 800;
    case 'miss': return 750;
    case 'cancel': return 850;
    case 'clash': return 900;
    case 'death': return 1500;
    case 'roundEnd': return 400;
  }
}

/** 一回合演出的总时长估算：开场缓冲 + 全部事件 + 收尾缓冲 */
export function roundPlaybackMs(events: GameEvent[]): number {
  return 600 + events.reduce((s, e) => s + eventPaceMs(e), 0) + 500;
}
