import { useLiveQuery } from 'dexie-react-hooks';
import { db, withNumbered, type AtBat, type Game, type InningOverride, type LineupSlot, type Player, type Result } from './db';

/** Wrap a 1-based batting order position around a lineup of n batters. */
export function wrap(order: number, n: number) {
  return ((((order - 1) % n) + n) % n) + 1;
}

export interface InningRow {
  inning: number;
  actual: number; // at-bats recorded in this inning
  count: number; // at-bats used for the batting order (override or actual)
  countOverridden: boolean;
  leadoff: number;
  leadoffOverridden: boolean;
}

/**
 * Derive the due-up table and the batter who is up.
 * Leadoff of inning i+1 = leadoff(i) + at-bats(i), wrapped, unless the coach picked a leadoff.
 */
export function computeInnings(n: number, currentInning: number, atBats: AtBat[], overrides: InningOverride[]) {
  const rows: InningRow[] = [];
  if (n === 0) return { rows, up: 1 };
  let leadoff = 1;
  for (let i = 1; i <= currentInning; i++) {
    const ov = overrides.find((o) => o.inning === i);
    const leadoffOverridden = ov?.leadoffOrder != null && ov.leadoffOrder <= n;
    if (leadoffOverridden) leadoff = ov!.leadoffOrder!;
    const actual = atBats.filter((a) => a.inning === i).length;
    const countOverridden = ov?.atBats != null;
    const count = countOverridden ? ov!.atBats! : actual;
    rows.push({ inning: i, actual, count, countOverridden, leadoff, leadoffOverridden });
    leadoff = wrap(leadoff + count, n);
  }
  return { rows, up: leadoff };
}

export interface GameData {
  game: Game;
  slots: LineupSlot[];
  players: Map<number, Player>;
  atBats: AtBat[];
  overrides: InningOverride[];
  rows: InningRow[];
  up: number;
  n: number;
}

export function useGameData(gameId: number | undefined): GameData | undefined | null {
  return useLiveQuery(async () => {
    if (gameId == null) return null;
    const game = await db.games.get(gameId);
    if (!game) return null;
    const [slots, atBats, overrides, roster] = await Promise.all([
      db.lineupSlots.where('gameId').equals(gameId).sortBy('order'),
      db.atBats.where('gameId').equals(gameId).sortBy('createdAt'),
      db.inningOverrides.where('gameId').equals(gameId).toArray(),
      db.players.where('teamId').equals(game.teamId).toArray(),
    ]);
    const players = withNumbered(
      new Map(roster.map((p) => [p.id, p])),
      [...slots.map((s) => s.playerId), ...atBats.map((a) => a.playerId)],
      game.teamId,
    );
    const n = slots.length;
    const { rows, up } = computeInnings(n, game.inning, atBats, overrides);
    return { game, slots, players, atBats, overrides, rows, up, n };
  }, [gameId]);
}

/** When an inning's at-bat count was overridden, keep it moving with new taps / undos. */
async function bumpOverride(gameId: number, inning: number, delta: number) {
  const ov = await db.inningOverrides.get([gameId, inning]);
  if (ov?.atBats != null) {
    await db.inningOverrides.put({ ...ov, atBats: Math.max(0, ov.atBats + delta) });
  }
}

export async function recordAtBat(g: GameData, result: Result, x: number | null, y: number | null) {
  const slot = g.slots.find((s) => s.order === g.up);
  if (!slot) return;
  return db.transaction('rw', db.atBats, db.inningOverrides, async () => {
    const id = await db.atBats.add({
      gameId: g.game.id,
      order: slot.order,
      playerId: slot.playerId,
      inning: g.game.inning,
      result,
      x,
      y,
      createdAt: Date.now(),
    } as AtBat);
    await bumpOverride(g.game.id, g.game.inning, +1);
    return id as number;
  });
}

export async function undoLast(g: GameData) {
  const last = g.atBats[g.atBats.length - 1];
  if (last) await deleteAtBat(last);
}

export async function deleteAtBat(a: AtBat) {
  await db.transaction('rw', db.atBats, db.inningOverrides, async () => {
    await db.atBats.delete(a.id);
    await bumpOverride(a.gameId, a.inning, -1);
  });
}

export async function setInningOverride(gameId: number, inning: number, patch: Partial<InningOverride>) {
  const cur = (await db.inningOverrides.get([gameId, inning])) ?? { gameId, inning };
  const next = { ...cur, ...patch };
  if (next.atBats == null && next.leadoffOrder == null) {
    await db.inningOverrides.delete([gameId, inning]);
  } else {
    await db.inningOverrides.put(next);
  }
}

/** Label for an at-bat in the lineup list: inning number, circled for a hit, K for strikeout. */
const CIRCLED = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
export function circled(n: number) {
  return CIRCLED[n] ?? `(${n})`;
}
export function atBatLabel(a: AtBat) {
  if (a.result === 'K') return 'K';
  return a.result === 'HIT' ? circled(a.inning) : String(a.inning);
}
