import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, fmtDate, OUR_TEAM, shortName, type AtBat } from '../db';
import { atBatLabel, deleteAtBat, recordAtBat, setInningOverride, undoLast, useGameData, wrap, type GameData } from '../logic';
import type { Nav } from '../App';
import Field, { MarksLayer, zoneOf, type FieldMark } from '../components/Field';
import Sheet from '../components/Sheet';
import { getHoldMs } from './Settings';
import Logo from '../components/Logo';

type Filter = { kind: 'all' } | { kind: 'up' } | { kind: 'next3' } | { kind: 'player'; playerId: number };
type Panel = null | 'status' | 'menu' | { mark: number } | { assign: number };

const LEADOFF_FLASH_MS = 5000;

export default function SprayChart({ gameId, nav }: { gameId: number; nav: Nav }) {
  const g = useGameData(gameId);
  const team = useLiveQuery(async () => (g ? db.teams.get(g.game.teamId) : undefined), [g?.game.teamId]);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [panel, setPanel] = useState<Panel>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [dueOpen, setDueOpen] = useState(false);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [leadoffFlash, setLeadoffFlash] = useState(false);
  const holdMs = useMemo(getHoldMs, []);

  useEffect(() => {
    if (!leadoffFlash) return;
    const t = setTimeout(() => setLeadoffFlash(false), LEADOFF_FLASH_MS);
    return () => clearTimeout(t);
  }, [leadoffFlash]);

  useEffect(() => {
    if (flashId == null) return;
    const t = setTimeout(() => setFlashId(null), 900);
    return () => clearTimeout(t);
  }, [flashId]);

  useEffect(() => {
    if (g === null) nav({ screen: 'setup' });
  }, [g, nav]);

  if (!g || !team) return null;

  const { game, slots, players, atBats, rows, up, n } = g;
  const readOnly = game.status === 'final';
  const opp = team.name;
  const slotAt = (order: number) => slots.find((s) => s.order === order);
  const upSlot = slotAt(up);
  const deckSlot = n > 1 ? slotAt(wrap(up + 1, n)) : undefined;
  const upPlayer = upSlot ? players.get(upSlot.playerId) : undefined;
  const deckPlayer = deckSlot ? players.get(deckSlot.playerId) : undefined;
  const currentRow = rows[rows.length - 1];
  const leadoffPid = currentRow ? slotAt(currentRow.leadoff)?.playerId : undefined;

  const byId = new Map(atBats.map((a) => [a.id, a]));
  const marks: FieldMark[] = atBats
    .filter((a) => a.result !== 'K' && a.x != null && a.y != null)
    .map((a) => ({
      id: a.id,
      order: a.order,
      hit: a.result === 'HIT',
      x: a.x!,
      y: a.y!,
      inning: a.inning,
      frozen: !readOnly && a.inning < game.inning,
    }));
  // Undo never reaches back into an inning that has ended.
  const lastAtBat = atBats[atBats.length - 1];
  const canUndo = !!lastAtBat && lastAtBat.inning >= game.inning;

  const focusPids: Set<number> | null = (() => {
    if (filter.kind === 'all' || n === 0) return null;
    if (filter.kind === 'player') return new Set([filter.playerId]);
    const count = filter.kind === 'up' ? 1 : Math.min(3, n);
    return new Set(Array.from({ length: count }, (_, i) => slotAt(wrap(up + i, n))?.playerId).filter((x): x is number => x != null));
  })();
  const dimmed = (m: FieldMark) => !!focusPids && !focusPids.has(byId.get(m.id)!.playerId);
  const highlighted = (m: FieldMark) => leadoffFlash && byId.get(m.id)?.playerId === leadoffPid;

  const scoreLine = `Inn ${game.inning} · ${OUR_TEAM} ${game.ourScore} – ${opp} ${game.theirScore}`;

  /* ----- actions ----- */
  async function record(result: 'HIT' | 'OUT' | 'K', x: number | null = null, y: number | null = null) {
    const id = await recordAtBat(g!, result, x, y);
    if (id != null && result !== 'K') setFlashId(id);
  }
  async function endInning() {
    await db.games.update(gameId, { inning: game.inning + 1 });
    setDueOpen(true);
    setLeadoffFlash(true);
  }
  async function moveMark(x: number, y: number) {
    if (movingId != null) await db.atBats.update(movingId, { x, y });
    setFlashId(movingId);
    setMovingId(null);
  }

  const menuMark = panel && typeof panel === 'object' && 'mark' in panel ? byId.get(panel.mark) : undefined;
  const assignMark = panel && typeof panel === 'object' && 'assign' in panel ? byId.get(panel.assign) : undefined;

  return (
    <div className="chart-page">
      <div className="chart-main">
        <div className="status-row">
          <Logo />
          <button className="status-line" onClick={() => !readOnly && setPanel('status')} disabled={readOnly}>
            {scoreLine} · At-bat {rows.reduce((s, r) => s + r.count, 0) + (readOnly ? 0 : 1)}
          </button>
          <button className="icon-btn" aria-label="Menu" onClick={() => setPanel('menu')}>
            ⋯
          </button>
        </div>

        {readOnly ? (
          <div className="final-banner">
            <span>
              Final · {fmtDate(game.date)} · vs. {opp} · {game.ourScore}–{game.theirScore}
            </span>
          </div>
        ) : movingId != null ? (
          <div className="batter-bar moving-bar">
            <span>Tap the new spot for this mark</span>
            <button className="link" onClick={() => setMovingId(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="batter-bar">
            <div className="up">
              Up: {upSlot ? `${up} · ${shortName(upPlayer)}` : '—'}
              {upPlayer?.jersey && <span className="jersey"> #{upPlayer.jersey}</span>}
            </div>
            {deckSlot && (
              <div className="deck">
                On deck: {deckSlot.order} · {shortName(deckPlayer)}
              </div>
            )}
          </div>
        )}

        <div className="chips">
          {(['all', 'up', 'next3'] as const).map((k) => (
            <button key={k} className={'chip' + (filter.kind === k ? ' on' : '')} onClick={() => setFilter({ kind: k })}>
              {k === 'all' ? 'All' : k === 'up' ? 'Batter up' : 'Next 3'}
            </button>
          ))}
          {filter.kind === 'player' && (
            <button className="chip on" onClick={() => setFilter({ kind: 'all' })}>
              {shortName(players.get(filter.playerId))} ✕
            </button>
          )}
        </div>

        <Field
          marks={marks}
          holdMs={holdMs}
          readOnly={readOnly}
          moving={movingId != null}
          dimmed={dimmed}
          highlighted={highlighted}
          flashId={flashId}
          caption={scoreLine}
          onOut={(x, y) => record('OUT', x, y)}
          onHit={(x, y) => record('HIT', x, y)}
          onMove={moveMark}
          onMarkMenu={(id) => setPanel({ mark: id })}
        />

        {!readOnly && (
          <div className="actions">
            <button className="btn action k" onClick={() => record('K')} disabled={n === 0}>
              K
            </button>
            <button className="btn action" onClick={() => undoLast(g)} disabled={!canUndo}>
              ↶ Undo
            </button>
            <button className="btn action" onClick={endInning}>
              End inning
            </button>
          </div>
        )}
      </div>

      <div className="chart-side">
        <LineupList g={g} filter={filter} setFilter={setFilter} readOnly={readOnly} />
        <DueUp g={g} open={dueOpen} setOpen={setDueOpen} readOnly={readOnly} />
      </div>

      <PrintSheet g={g} opp={opp} marks={marks.map((m) => ({ ...m, frozen: false }))} />

      {panel === 'status' && <StatusSheet g={g} opp={opp} onClose={() => setPanel(null)} />}

      {panel === 'menu' && (
        <Sheet title="Game" onClose={() => setPanel(null)}>
          <div className="menu-list">
            {!readOnly && (
              <button className="btn big" onClick={() => nav({ screen: 'order', gameId })}>
                {slots.some((s) => s.playerId < 0) ? 'Allocate names to numbers' : 'Edit lineup'}
              </button>
            )}
            <button
              className="btn big"
              onClick={() => {
                setPanel(null);
                setTimeout(() => printSheet(opp, game.date), 50);
              }}
            >
              Export PDF / Print
            </button>
            {readOnly ? (
              <button className="btn big" onClick={() => db.games.update(gameId, { status: 'live' }).then(() => setPanel(null))}>
                Reopen game for editing
              </button>
            ) : (
              <button className="btn big" onClick={() => db.games.update(gameId, { status: 'final' }).then(() => nav({ screen: 'setup' }))}>
                End game (final)
              </button>
            )}
            <button className="btn big" onClick={() => nav({ screen: 'setup' })}>
              Game setup / past games
            </button>
          </div>
        </Sheet>
      )}

      {menuMark && (
        <Sheet title={markTitle(menuMark, g)} onClose={() => setPanel(null)}>
          <div className="menu-list">
            <button
              className="btn big"
              onClick={() => db.atBats.update(menuMark.id, { result: menuMark.result === 'HIT' ? 'OUT' : 'HIT' }).then(() => setPanel(null))}
            >
              {menuMark.result === 'HIT' ? 'Change to out' : 'Change to hit'}
            </button>
            <button
              className="btn big"
              onClick={() => {
                setMovingId(menuMark.id);
                setPanel(null);
              }}
            >
              Move
            </button>
            <button className="btn big" onClick={() => setPanel({ assign: menuMark.id })}>
              Assign to another batter
            </button>
            <button className="btn big danger" onClick={() => deleteAtBat(menuMark).then(() => setPanel(null))}>
              Delete
            </button>
          </div>
        </Sheet>
      )}

      {assignMark && (
        <Sheet title="Assign to batter" onClose={() => setPanel(null)}>
          <div className="menu-list">
            {slots.map((s) => (
              <button
                key={s.order}
                className={'btn big' + (s.playerId === assignMark.playerId ? ' current' : '')}
                onClick={() => db.atBats.update(assignMark.id, { order: s.order, playerId: s.playerId }).then(() => setPanel(null))}
              >
                {s.order} · {shortName(players.get(s.playerId))}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function markTitle(a: AtBat, g: GameData) {
  const zone = a.x != null && a.y != null ? zoneOf(a.x, a.y) : null;
  return `${a.order} · ${shortName(g.players.get(a.playerId))} — ${a.result === 'HIT' ? 'Hit' : 'Out'}, inn ${a.inning}${zone ? ` · ${zone}` : ''}`;
}

/* ---------- lineup list ---------- */

function LineupList({
  g,
  filter,
  setFilter,
  readOnly,
}: {
  g: GameData;
  filter: Filter;
  setFilter: (f: Filter) => void;
  readOnly: boolean;
}) {
  return (
    <ol className="lineup">
      {g.slots.map((s) => {
        const p = g.players.get(s.playerId);
        const abs = g.atBats.filter((a) => a.playerId === s.playerId);
        const isUp = !readOnly && s.order === g.up;
        const on = filter.kind === 'player' && filter.playerId === s.playerId;
        return (
          <li key={s.order}>
            <button
              className={'lineup-row' + (isUp ? ' is-up' : '') + (on ? ' on' : '')}
              onClick={() => setFilter(on ? { kind: 'all' } : { kind: 'player', playerId: s.playerId })}
            >
              <span className="lu-no">{s.order}</span>
              <span className="lu-name">{p?.lastName || p?.firstName}</span>
              <span className="lu-jersey">{p?.jersey ? `#${p.jersey}` : ''}</span>
              <span className="lu-abs">
                AB {abs.length}
                {abs.length > 0 && ' · '}
                {abs.map((a) => (
                  <span key={a.id} className={'ab-' + a.result.toLowerCase()}>
                    {atBatLabel(a)}{' '}
                  </span>
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- due up by inning ---------- */

function DueUp({ g, open, setOpen, readOnly }: { g: GameData; open: boolean; setOpen: (b: boolean) => void; readOnly: boolean }) {
  const { game, slots, players, rows, n } = g;
  return (
    <section className="dueup">
      <button className="dueup-head" onClick={() => setOpen(!open)}>
        <span>Due up by inning</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <table>
          <thead>
            <tr>
              <th>Inn</th>
              <th>At-bats</th>
              <th>Leads off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.inning} className={r.inning === game.inning ? 'current' : ''}>
                <td>{r.inning}</td>
                <td>
                  {readOnly ? (
                    r.count
                  ) : (
                    <span className="stepper small">
                      <button onClick={() => setInningOverride(game.id, r.inning, { atBats: Math.max(0, r.count - 1) })}>−</button>
                      <span className={r.countOverridden ? 'overridden' : ''}>{r.count}</span>
                      <button onClick={() => setInningOverride(game.id, r.inning, { atBats: r.count + 1 })}>+</button>
                      {r.countOverridden && (
                        <button className="reset" title={`Back to recorded (${r.actual})`} onClick={() => setInningOverride(game.id, r.inning, { atBats: undefined })}>
                          ↺
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  {readOnly || n === 0 ? (
                    `${r.leadoff} · ${shortName(players.get(slots.find((s) => s.order === r.leadoff)?.playerId ?? 0))}`
                  ) : (
                    <select
                      className={r.leadoffOverridden ? 'overridden' : ''}
                      value={r.leadoff}
                      onChange={(e) => setInningOverride(game.id, r.inning, { leadoffOrder: Number(e.target.value) })}
                    >
                      {slots.map((s) => (
                        <option key={s.order} value={s.order}>
                          {s.order} · {shortName(players.get(s.playerId))}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ---------- inning / score steppers ---------- */

function StatusSheet({ g, opp, onClose }: { g: GameData; opp: string; onClose: () => void }) {
  const { game } = g;
  const row = (label: string, key: 'inning' | 'ourScore' | 'theirScore', min: number) => (
    <div className="stepper-row">
      <span>{label}</span>
      <span className="stepper">
        <button onClick={() => db.games.update(game.id, { [key]: Math.max(min, game[key] - 1) })}>−</button>
        <span className="val">{game[key]}</span>
        <button onClick={() => db.games.update(game.id, { [key]: game[key] + 1 })}>+</button>
      </span>
    </div>
  );
  return (
    <Sheet title="Inning & score" onClose={onClose}>
      {row('Inning', 'inning', 1)}
      {row(OUR_TEAM, 'ourScore', 0)}
      {row(opp, 'theirScore', 0)}
    </Sheet>
  );
}

/* ---------- printable A4 sheet (Export PDF) ---------- */

function printSheet(opp: string, date: string) {
  const prev = document.title;
  document.title = `Spray chart - ${opp} - ${date}`;
  window.print();
  setTimeout(() => (document.title = prev), 1000);
}

function PrintSheet({ g, opp, marks }: { g: GameData; opp: string; marks: FieldMark[] }) {
  const { game, slots, players, atBats, rows } = g;
  return (
    <div className="print-sheet">
      <div className="ps-head">
        <h1>
          {OUR_TEAM} vs. {opp}
        </h1>
        <div className="ps-meta">
          {fmtDate(game.date)} {game.date.slice(0, 4)}
          {game.field ? ` · ${game.field}` : ''} · Inn {game.inning} · {OUR_TEAM} {game.ourScore} – {opp} {game.theirScore}
        </div>
      </div>
      <div className="ps-body">
        <div className="ps-lineup">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Batter</th>
                <th>No.</th>
                <th>AB</th>
                <th>Results</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => {
                const p = players.get(s.playerId);
                const abs = atBats.filter((a) => a.playerId === s.playerId);
                return (
                  <tr key={s.order}>
                    <td>{s.order}</td>
                    <td>{p ? (p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName) : '?'}</td>
                    <td>{p?.jersey ?? ''}</td>
                    <td>{abs.length}</td>
                    <td>{abs.map(atBatLabel).join(' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <table className="ps-due">
            <thead>
              <tr>
                <th>Inn</th>
                <th>At-bats</th>
                <th>Leads off</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.inning}>
                  <td>{r.inning}</td>
                  <td>{r.count}</td>
                  <td>
                    {r.leadoff} · {shortName(players.get(slots.find((s) => s.order === r.leadoff)?.playerId ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ps-key">Plain number = out · circled = hit · K = strikeout. Results list the inning of each at-bat.</p>
        </div>
        <div className="ps-field">
          <img src={`${import.meta.env.BASE_URL}field.svg`} alt="" />
          <svg viewBox="0 0 1000 1000">
            <MarksLayer marks={marks} caption={`Inn ${game.inning} · ${OUR_TEAM} ${game.ourScore} – ${opp} ${game.theirScore}`} />
          </svg>
        </div>
      </div>
    </div>
  );
}
