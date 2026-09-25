import Dexie, { type EntityTable, type Table } from 'dexie';
import rosters from './data/rosters.json';

export const OUR_TEAM = "Cito Gaston's";

export const FIELDS = [
  'Ashton Meadows',
  'Centennial Park – North Diamond',
  'Centennial Park – South Diamond',
];

export type Result = 'HIT' | 'OUT' | 'K';

export interface Team {
  id: string;
  name: string;
}

export interface Player {
  id: number;
  teamId: string;
  firstName: string;
  lastName: string;
  jersey?: string;
  /** Soft-deleted from the roster; kept so old at-bats still show a name. */
  removed?: boolean;
}

export interface Game {
  id: number;
  teamId: string;
  date: string; // yyyy-mm-dd
  field?: string;
  ourScore: number;
  theirScore: number;
  inning: number;
  lineupPhoto?: Blob;
  status: 'live' | 'final';
  createdAt: number;
}

export interface LineupSlot {
  gameId: number;
  order: number; // 1–15
  playerId: number;
}

export interface AtBat {
  id: number;
  gameId: number;
  order: number;
  playerId: number;
  inning: number;
  result: Result;
  x: number | null; // 0–1 fraction of the field viewBox
  y: number | null;
  createdAt: number;
}

export interface InningOverride {
  gameId: number;
  inning: number;
  atBats?: number;
  leadoffOrder?: number;
}

export const db = new Dexie('cito-spray-chart') as Dexie & {
  teams: EntityTable<Team, 'id'>;
  players: EntityTable<Player, 'id'>;
  games: EntityTable<Game, 'id'>;
  lineupSlots: Table<LineupSlot, [number, number]>;
  atBats: EntityTable<AtBat, 'id'>;
  inningOverrides: Table<InningOverride, [number, number]>;
};

db.version(1).stores({
  teams: 'id, name',
  players: '++id, teamId',
  games: '++id, status, date, createdAt',
  lineupSlots: '[gameId+order], gameId',
  atBats: '++id, gameId, createdAt',
  inningOverrides: '[gameId+inning], gameId',
});

db.on('populate', async (tx) => {
  await tx.table('teams').bulkAdd(rosters.map((t) => ({ id: t.id, name: t.name })));
  await tx.table('players').bulkAdd(
    rosters.flatMap((t) => t.players.map((p) => ({ ...p, teamId: t.id }))),
  );
});

// Ask Safari not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

/* ---------- helpers ---------- */

export function fullName(p?: Player) {
  if (!p) return '?';
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

export function shortName(p?: Player) {
  if (!p) return '?';
  return p.lastName ? `${p.firstName[0]}. ${p.lastName}` : p.firstName;
}

/** A lineup started "without names" uses placeholder batters with negative ids: -3 is "Batter 3". */
export function numberedPlayer(id: number, teamId: string): Player {
  return { id, teamId, firstName: `Batter ${-id}`, lastName: '' };
}

/** Add placeholder batters for any negative ids so lookups by id always find a name. */
export function withNumbered(players: Map<number, Player>, ids: number[], teamId: string) {
  for (const id of ids) if (id < 0 && !players.has(id)) players.set(id, numberedPlayer(id, teamId));
  return players;
}

/** Sort key: last name, or first name for first-name-only players. */
export function sortKey(p: Player) {
  return `${(p.lastName || p.firstName).toLowerCase()} ${p.firstName.toLowerCase()}`;
}

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

export function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function setLineup(gameId: number, playerIds: number[]) {
  await db.transaction('rw', db.lineupSlots, async () => {
    await db.lineupSlots.where('gameId').equals(gameId).delete();
    await db.lineupSlots.bulkAdd(playerIds.map((playerId, i) => ({ gameId, order: i + 1, playerId })));
  });
}

/**
 * Save a lineup where at-bats belong to the batting position, not the name: used when names are
 * allocated to a numbered lineup after the fact. Placeholders are renumbered to match their spot
 * ("Batter 2" is always in spot 2), and every at-bat takes the player now in its spot.
 */
export async function setLineupByPosition(gameId: number, ids: number[]) {
  const norm = ids.map((id, i) => (id < 0 ? -(i + 1) : id));
  await db.transaction('rw', db.lineupSlots, db.atBats, async () => {
    await db.lineupSlots.where('gameId').equals(gameId).delete();
    await db.lineupSlots.bulkAdd(norm.map((playerId, i) => ({ gameId, order: i + 1, playerId })));
    const atBats = await db.atBats.where('gameId').equals(gameId).toArray();
    for (const a of atBats) {
      const pid = norm[a.order - 1];
      if (pid != null && pid !== a.playerId) await db.atBats.update(a.id, { playerId: pid });
    }
  });
  return norm;
}

export async function deleteGame(gameId: number) {
  await db.transaction('rw', [db.games, db.lineupSlots, db.atBats, db.inningOverrides] as Table[], async () => {
    await db.games.delete(gameId);
    await db.lineupSlots.where('gameId').equals(gameId).delete();
    await db.atBats.where('gameId').equals(gameId).delete();
    await db.inningOverrides.where('gameId').equals(gameId).delete();
  });
}

/* ---------- backup ---------- */

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export async function exportAll() {
  const games = await db.games.toArray();
  return {
    app: 'cito-spray-chart',
    version: 1,
    exportedAt: new Date().toISOString(),
    teams: await db.teams.toArray(),
    players: await db.players.toArray(),
    games: await Promise.all(
      games.map(async (g) => ({
        ...g,
        lineupPhoto: g.lineupPhoto ? await blobToDataUrl(g.lineupPhoto) : undefined,
      })),
    ),
    lineupSlots: await db.lineupSlots.toArray(),
    atBats: await db.atBats.toArray(),
    inningOverrides: await db.inningOverrides.toArray(),
  };
}

export async function importAll(data: Awaited<ReturnType<typeof exportAll>>) {
  if (data?.app !== 'cito-spray-chart') throw new Error('Not a spray chart backup file');
  const games = await Promise.all(
    data.games.map(async (g) => ({
      ...g,
      lineupPhoto: g.lineupPhoto ? await (await fetch(g.lineupPhoto)).blob() : undefined,
    })),
  );
  const tables = [db.teams, db.players, db.games, db.lineupSlots, db.atBats, db.inningOverrides] as Table[];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.teams.bulkAdd(data.teams);
    await db.players.bulkAdd(data.players);
    await db.games.bulkAdd(games);
    await db.lineupSlots.bulkAdd(data.lineupSlots);
    await db.atBats.bulkAdd(data.atBats);
    await db.inningOverrides.bulkAdd(data.inningOverrides);
  });
}
