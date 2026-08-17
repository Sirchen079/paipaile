export type MoveId =
  | 'charge'
  | 'shield'
  | 'superShield'
  | 'flyUp'
  | 'burrow'
  | 'shock'
  | 'hammerSky'
  | 'hammerGround'
  | 'superShock'
  | 'hammerBoth'
  | 'finger'
  | 'magicBurst'
  | 'voidRift'
  | 'ultimate';

export type MoveKind = 'buff' | 'shield' | 'stance' | 'single' | 'aoe' | 'counter';

export interface MoveDef {
  id: MoveId;
  name: string;
  cost: 0 | 1 | 2 | 3;
  kind: MoveKind;
  needsTarget: boolean;
  desc: string;
}

export interface PlayerState {
  id: string;
  name: string;
  avatar: string;
  hp: number;
  v: number;
  alive: boolean;
  team?: string;
  connected: boolean;
}

export interface Submission {
  playerId: string;
  moveId: MoveId;
  targetId?: string;
}

export interface EngineConfig {
  friendlyFire: boolean;
}

export type GameEvent =
  | { type: 'reveal'; p: string; move: MoveId; target?: string }
  | { type: 'vChange'; p: string; delta: number; v: number }
  | { type: 'stance'; p: string; move: 'flyUp' | 'burrow' }
  | { type: 'cancel'; by: 'magicBurst' | 'voidRift'; p: string; move: MoveId }
  | { type: 'clash'; a: string; b: string; winner: string | null }
  | { type: 'hit'; src: string; dst: string; move: MoveId; lethal: boolean }
  | { type: 'blocked'; src: string; dst: string; move: MoveId; by: 'shield' | 'superShield' }
  | { type: 'miss'; src: string; dst: string; move: MoveId; reason: 'flyUp' | 'burrow' | 'stance' }
  | { type: 'death'; p: string }
  | { type: 'roundEnd'; round: number };

export interface RoundResult {
  events: GameEvent[];
  players: PlayerState[];
}

export interface WinCheck {
  over: boolean;
  winners: string[];
  draw: boolean;
}
