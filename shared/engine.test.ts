import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRound, checkWin } from './engine';
import type { PlayerState, Submission } from './types';

const P = (id: string, over: Partial<PlayerState> = {}): PlayerState => ({
  id, name: id, avatar: '🙂', hp: 1, v: 9, alive: true, connected: true, ...over,
});
const CFG = { friendlyFire: true };
const run = (players: PlayerState[], subs: Submission[], cfg = CFG) => resolveRound(players, subs, cfg, 1);
const ev = (r: ReturnType<typeof run>, t: string) => r.events.filter((e: any) => e.type === t) as any[];
const has = (r: ReturnType<typeof run>, t: string, match: (e: any) => boolean = () => true) =>
  r.events.some((e: any) => e.type === t && match(e));

test('爆V：+1V 且封顶 99', () => {
  assert.equal(run([P('a', { v: 0 })], []).players[0].v, 1);
  assert.equal(run([P('a', { v: 99 })], []).players[0].v, 99);
});

test('扣费：超冲花 2V', () => {
  const r = run([P('a', { v: 3 }), P('b')], [{ playerId: 'a', moveId: 'superShock', targetId: 'b' }]);
  assert.equal(r.players[0].v, 1);
});

test('普冲 → 爆V者：命中并淘汰', () => {
  const r = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'shock', targetId: 'b' }, { playerId: 'b', moveId: 'charge' }]);
  assert.ok(has(r, 'hit', (e) => e.dst === 'b' && e.lethal));
  assert.ok(has(r, 'death', (e) => e.p === 'b'));
  assert.equal(r.players[1].alive, false);
});

test('普冲 → 普盾/超盾：被挡住', () => {
  const r1 = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'shock', targetId: 'b' }, { playerId: 'b', moveId: 'shield' }]);
  assert.ok(has(r1, 'blocked', (e) => e.by === 'shield'));
  assert.equal(r1.players[1].alive, true);
  const r2 = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'shock', targetId: 'b' }, { playerId: 'b', moveId: 'superShield' }]);
  assert.ok(has(r2, 'blocked', (e) => e.by === 'superShield'));
});

test('D1：飞天/遁地躲开一切单体招（普冲/超冲/一阳指）', () => {
  for (const mv of ['shock', 'superShock', 'finger'] as const) {
    for (const st of ['flyUp', 'burrow'] as const) {
      const r = run([P('a'), P('b')], [{ playerId: 'a', moveId: mv, targetId: 'b' }, { playerId: 'b', moveId: st }]);
      assert.ok(has(r, 'miss', (e) => e.reason === st), `${mv} vs ${st}`);
      assert.equal(r.players[1].alive, true);
    }
  }
});

test('超冲：穿透普通盾、被超级盾挡住、能打锤天者', () => {
  const r1 = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'superShock', targetId: 'b' }, { playerId: 'b', moveId: 'shield' }]);
  assert.ok(has(r1, 'hit', (e) => e.dst === 'b'));
  const r2 = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'superShock', targetId: 'b' }, { playerId: 'b', moveId: 'superShield' }]);
  assert.ok(has(r2, 'blocked', (e) => e.by === 'superShield'));
  const r3 = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'superShock', targetId: 'b' }, { playerId: 'b', moveId: 'hammerSky' }]);
  assert.ok(has(r3, 'hit', (e) => e.dst === 'b'));
});

test('一阳指：无视双盾、打锤天锤地者、打不中锤天者', () => {
  for (const d of ['shield', 'superShield', 'hammerBoth'] as const) {
    const r = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'finger', targetId: 'b' }, { playerId: 'b', moveId: d }]);
    assert.ok(has(r, 'hit', (e) => e.dst === 'b'), `finger vs ${d}`);
  }
  const r2 = run([P('a'), P('b')], [{ playerId: 'a', moveId: 'finger', targetId: 'b' }, { playerId: 'b', moveId: 'hammerSky' }]);
  assert.ok(has(r2, 'miss', (e) => e.reason === 'stance'));
});

test('锤天只打全部飞天者；锤地只打遁地者', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'hammerSky' },
    { playerId: 'b', moveId: 'flyUp' },
    { playerId: 'c', moveId: 'burrow' },
    { playerId: 'd', moveId: 'charge' },
  ];
  const r = run([P('a'), P('b'), P('c'), P('d')], subs);
  assert.ok(has(r, 'hit', (e) => e.dst === 'b'));
  assert.ok(!has(r, 'hit', (e) => e.dst === 'c' || e.dst === 'd'));
});

test('锤天锤地：打全部飞天+遁地+魔爆者', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'hammerBoth' },
    { playerId: 'b', moveId: 'flyUp' },
    { playerId: 'c', moveId: 'burrow' },
    { playerId: 'd', moveId: 'magicBurst' },
    { playerId: 'e', moveId: 'charge' },
  ];
  const r = run([P('a'), P('b'), P('c'), P('d'), P('e')], subs);
  for (const id of ['b', 'c', 'd']) assert.ok(has(r, 'hit', (e) => e.dst === id), `hit ${id}`);
  assert.ok(!has(r, 'hit', (e) => e.dst === 'e' || e.dst === 'a'));
});

test('D2：魔爆取消普冲/超冲/究极并反伤，其他状态不受影响', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'magicBurst' },
    { playerId: 'b', moveId: 'shock', targetId: 'a' },
    { playerId: 'c', moveId: 'superShock', targetId: 'd' },
    { playerId: 'd', moveId: 'charge' },
    { playerId: 'e', moveId: 'ultimate' },
    { playerId: 'f', moveId: 'shield' },
  ];
  const r = run([P('a'), P('b'), P('c'), P('d'), P('e'), P('f')], subs);
  for (const id of ['b', 'c', 'e']) {
    assert.ok(has(r, 'cancel', (e) => e.p === id), `cancel ${id}`);
    assert.ok(has(r, 'hit', (e) => e.dst === id), `magicBurst hits ${id}`);
  }
  assert.ok(!has(r, 'hit', (e) => e.dst === 'a' || e.dst === 'd' || e.dst === 'f'));
});

test('扭曲虚空：取消并反伤一阳指使用者', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'voidRift' },
    { playerId: 'b', moveId: 'finger', targetId: 'c' },
    { playerId: 'c', moveId: 'charge' },
  ];
  const r = run([P('a'), P('b'), P('c')], subs);
  assert.ok(has(r, 'cancel', (e) => e.p === 'b' && e.by === 'voidRift'));
  assert.ok(has(r, 'hit', (e) => e.dst === 'b'));
  assert.ok(!has(r, 'hit', (e) => e.dst === 'a' || e.dst === 'c'));
});

test('对冲：普冲 vs 超冲（互指）→ 高档命中，低档作废', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'shock', targetId: 'b' },
    { playerId: 'b', moveId: 'superShock', targetId: 'a' },
  ];
  const r = run([P('a'), P('b')], subs);
  assert.ok(has(r, 'clash', (e) => e.winner === 'b'));
  assert.ok(has(r, 'hit', (e) => e.dst === 'a'));
  assert.ok(!has(r, 'hit', (e) => e.dst === 'b'));
});

test('对冲：一阳指 vs 超冲（同 2V 互指）→ 双方互抵（裁定 #6）', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'finger', targetId: 'b' },
    { playerId: 'b', moveId: 'superShock', targetId: 'a' },
  ];
  const r = run([P('a'), P('b')], subs);
  assert.ok(has(r, 'clash', (e) => e.winner === null));
  assert.ok(!has(r, 'hit'));
  assert.equal(r.players[0].alive && r.players[1].alive, true);
});

test('对冲三角（A→B、B→C、C→A 非互指）：各按判定表结算', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'shock', targetId: 'b' },
    { playerId: 'b', moveId: 'superShock', targetId: 'c' },
    { playerId: 'c', moveId: 'finger', targetId: 'a' },
  ];
  const r = run([P('a'), P('b'), P('c')], subs);
  assert.ok(!has(r, 'clash'));
  assert.ok(has(r, 'hit', (e) => e.dst === 'a'), 'a 被一阳指打中');
  assert.ok(has(r, 'hit', (e) => e.dst === 'b'), 'b 被普冲打中');
  assert.ok(has(r, 'miss', (e) => e.dst === 'c' && e.reason === 'stance'), '超冲打不中一阳指架势');
  const w = checkWin(r.players);
  assert.deepEqual(w, { over: true, winners: ['c'], draw: false });
});

test('究极：命中表全量核对（含打不中爆V、被超盾挡、锤天锤地/一阳指/究极免疫）', () => {
  // 注意不放魔爆者：魔爆会直接取消究极（D2），该交互由专门用例覆盖
  const defs: [string, any][] = [
    ['b', 'flyUp'], ['c', 'burrow'], ['d', 'hammerSky'], ['e', 'hammerGround'],
    ['f', 'shock'], ['g', 'superShock'], ['h', 'shield'], ['i', 'voidRift'],
    ['j', 'charge'], ['k', 'superShield'], ['l', 'hammerBoth'], ['m', 'finger'],
  ];
  const players = [P('a'), ...defs.map(([id, mv]) => P(id))];
  const subs: Submission[] = [{ playerId: 'a', moveId: 'ultimate' }];
  for (const [id, mv] of defs) subs.push({ playerId: id, moveId: mv, ...(mv === 'shock' || mv === 'superShock' || mv === 'finger' ? { targetId: 'a' } : {}) });
  const r = run(players, subs);
  for (const [id] of defs.slice(0, 8)) assert.ok(has(r, 'hit', (e) => e.dst === id), `ultimate hits ${id}`);
  // 场景里锤天/锤地/扭曲虚空会额外命中 b/c/m，属正常互动；这里只断言"究极本身"没碰免疫者
  assert.ok(!has(r, 'hit', (e) => (e.dst === 'j' || e.dst === 'l' || e.dst === 'm') && e.move === 'ultimate'), 'immune set');
  assert.ok(has(r, 'blocked', (e) => e.dst === 'k' && e.by === 'superShield'));
  assert.ok(!has(r, 'hit', (e) => e.dst === 'a'), '其余人的单体招没打中究极者（架势免疫）');
});

test('同档互指（普冲 vs 普冲）：互抵不死人', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'shock', targetId: 'b' },
    { playerId: 'b', moveId: 'shock', targetId: 'a' },
  ];
  const r = run([P('a'), P('b')], subs);
  assert.ok(has(r, 'clash', (e) => e.winner === null));
  assert.ok(!has(r, 'hit'));
});

test('超时未出招：自动爆V（空提交）', () => {
  const r = run([P('a', { v: 2 }), P('b', { v: 2 })], [{ playerId: 'a', moveId: 'charge' }]);
  assert.equal(r.players[0].v, 3);
  assert.equal(r.players[1].v, 3);
  assert.ok(r.events.every((e: any) => e.type !== 'hit'));
});

test('V 不足的非法出招：按爆V处理', () => {
  const r = run([P('a', { v: 0 }), P('b')], [{ playerId: 'a', moveId: 'ultimate' }]);
  assert.equal(r.players[0].v, 1);
  assert.ok(r.events.some((e: any) => e.type === 'reveal' && e.p === 'a' && e.move === 'charge'));
});

test('友伤关闭：AoE 跳过队友、单体不能指定队友（转为爆V）', () => {
  const cfg = { friendlyFire: false };
  const players = [P('a', { team: 'red' }), P('b', { team: 'red' }), P('c', { team: 'blue' })];
  const r1 = resolveRound(players, [
    { playerId: 'a', moveId: 'ultimate' },
    { playerId: 'b', moveId: 'charge' },
    { playerId: 'c', moveId: 'flyUp' },
  ], cfg, 1);
  assert.ok(!has(r1, 'hit', (e) => e.dst === 'b'), '队友免伤');
  assert.ok(has(r1, 'hit', (e) => e.dst === 'c'));
  const r2 = resolveRound(players, [
    { playerId: 'a', moveId: 'finger', targetId: 'b' },
    { playerId: 'b', moveId: 'charge' },
    { playerId: 'c', moveId: 'charge' },
  ], cfg, 1);
  assert.ok(r2.events.some((e: any) => e.type === 'reveal' && e.p === 'a' && e.move === 'charge'), '指定队友无效→爆V');
});

test('多人同回合命中同一目标：同时扣血、一起阵亡', () => {
  const subs: Submission[] = [
    { playerId: 'a', moveId: 'shock', targetId: 'c' },
    { playerId: 'b', moveId: 'shock', targetId: 'c' },
    { playerId: 'c', moveId: 'charge' },
  ];
  const r = run([P('a'), P('b'), P('c', { hp: 2 })], subs);
  assert.equal(ev(r, 'hit').filter((e: any) => e.dst === 'c').length, 2);
  assert.ok(has(r, 'death', (e) => e.p === 'c'));
});

test('组队胜负：歼灭对方全队', () => {
  const w = checkWin([P('a', { team: 'red' }), P('b', { team: 'red', alive: false }), P('c', { team: 'blue', alive: false })]);
  assert.deepEqual(w, { over: true, winners: ['a'], draw: false });
});
