import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, fullName, OUR_TEAM, setLineup, setLineupByPosition, sortKey, withNumbered, type Player } from '../db';
import type { Nav } from '../App';
import PhotoViewer from '../components/PhotoViewer';
import Sheet, { Confirm } from '../components/Sheet';
import Logo from '../components/Logo';

const MAX = 15;
const ROW_H = 56;

export default function BattingOrder({ gameId, nav }: { gameId: number; nav: Nav }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const team = useLiveQuery(async () => (game ? db.teams.get(game.teamId) : undefined), [game?.teamId]);
  const roster = useLiveQuery(
    async () => (game ? (await db.players.where('teamId').equals(game.teamId).toArray()) : []),
    [game?.teamId],
  );
  const started = useLiveQuery(() => db.atBats.where('gameId').equals(gameId).count(), [gameId]);

  // Local copy of the order is the source of truth while on this screen; every change is saved immediately.
  const [order, setOrder] = useState<number[] | null>(null);
  useEffect(() => {
    if (order === null)
      db.lineupSlots.where('gameId').equals(gameId).sortBy('order').then((s) => setOrder(s.map((x) => x.playerId)));
  }, [gameId, order]);

  // Allocating names to a numbered lineup: null = not asked yet, true = allocating.
  const [allocating, setAllocating] = useState<boolean | null>(null);
  const history = useRef<number[][]>([]);

  function update(next: number[]) {
    if (allocating) {
      history.current.push(order ?? []);
      saveByPosition(next);
    } else {
      setOrder(next);
      setLineup(gameId, next);
    }
  }
  function saveByPosition(next: number[]) {
    setOrder(next.map((id, i) => (id < 0 ? -(i + 1) : id)));
    setLineupByPosition(gameId, next);
  }
  function undoAllocation() {
    const prev = history.current.pop();
    if (prev) saveByPosition(prev);
  }
  /** Allocating: a tapped name fills the lowest open number. */
  function allocate(pid: number) {
    if (!order) return;
    const i = order.findIndex((id) => id < 0);
    if (i < 0) return;
    const next = [...order];
    next[i] = pid;
    update(next);
  }
  /** Allocating: tapping a name in the order turns that spot back into "Batter N". */
  function unallocate(i: number) {
    if (!order) return;
    const next = [...order];
    next[i] = -(i + 1);
    update(next);
  }

  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);
  const [askNoNames, setAskNoNames] = useState(false);
  const [batterCount, setBatterCount] = useState(10);

  const players = useMemo(
    () => withNumbered(new Map((roster ?? []).map((p) => [p.id, p])), order ?? [], game?.teamId ?? ''),
    [roster, order, game?.teamId],
  );
  const available = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (roster ?? [])
      .filter((p) => !p.removed && !order?.includes(p.id))
      .filter((p) => !needle || fullName(p).toLowerCase().includes(needle))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [roster, order, q]);

  /* ----- photo ----- */
  const photoUrl = useMemo(() => (game?.lineupPhoto ? URL.createObjectURL(game.lineupPhoto) : null), [game?.lineupPhoto]);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) await db.games.update(gameId, { lineupPhoto: f });
    e.target.value = '';
  }

  /* ----- drag to reorder ----- */
  const [drag, setDrag] = useState<{ index: number; startY: number; dy: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  function targetIndex(d: { index: number; dy: number }, len: number) {
    return Math.max(0, Math.min(len - 1, d.index + Math.round(d.dy / ROW_H)));
  }
  function onHandleDown(e: React.PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    dragRef.current = { index, startY: e.clientY, dy: 0 };
    setDrag(dragRef.current);
  }
  function onHandleMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // Keep the ref current too: a quick flick can release before React re-renders.
    dragRef.current = { ...d, dy: e.clientY - d.startY };
    setDrag(dragRef.current);
  }
  function onHandleUp(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !order) return setDrag(null);
    d.dy = e.clientY - d.startY;
    const to = targetIndex(d, order.length);
    if (to !== d.index) {
      const next = [...order];
      const [m] = next.splice(d.index, 1);
      next.splice(to, 0, m);
      update(next);
    }
    setDrag(null);
  }
  function shiftFor(i: number) {
    if (!drag || !order) return 0;
    if (i === drag.index) return drag.dy;
    const to = targetIndex(drag, order.length);
    if (drag.index < to && i > drag.index && i <= to) return -ROW_H;
    if (drag.index > to && i < drag.index && i >= to) return ROW_H;
    return 0;
  }

  if (!game || !order || !roster) return null;
  const hasNumbers = order.some((id) => id < 0);
  const openNumbers = order.filter((id) => id < 0).length;
  const full = allocating ? openNumbers === 0 : order.length >= MAX;
  const inProgress = (started ?? 0) > 0 || hasNumbers;

  return (
    <div className="page order-page">
      <header className="topbar">
        <Logo />
        <button className="link" onClick={() => nav(inProgress ? { screen: 'chart', gameId } : { screen: 'setup' })}>
          ‹ {inProgress ? 'Chart' : 'Back'}
        </button>
        <h1 className="title small">
          {OUR_TEAM} vs. {team?.name}
        </h1>
      </header>

      <div className="photo-strip">
        <label className="btn">
          📷 {game.lineupPhoto ? 'Retake photo' : 'Take photo of lineup'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
        </label>
        {photoUrl && (
          <button className="thumb" onClick={() => setViewPhoto(true)} aria-label="View lineup photo">
            <img src={photoUrl} alt="Lineup" />
          </button>
        )}
      </div>

      <section className="order-list">
        <div className="section-head">
          <h2>
            Batting order <span className="muted">({order.length}/{MAX})</span>
          </h2>
          {allocating ? (
            <button className="link" disabled={history.current.length === 0} onClick={undoAllocation}>
              ↶ Undo
            </button>
          ) : (
            order.length > 0 &&
            !hasNumbers && (
              <button className="link" onClick={() => update([])}>
                Clear order
              </button>
            )
          )}
        </div>
        {order.length === 0 && <p className="muted hint">Tap names below in the umpire's batting order.</p>}
        {allocating && (
          <p className="muted hint">
            Tap names in batting order; each fills the next number. Drag ≡ to move a name to its right spot; the at-bats in that spot go
            with it. Tap a name above to turn it back into a number.
          </p>
        )}
        {hasNumbers && allocating === false && (
          <button className="btn big" onClick={() => setAllocating(true)}>
            Allocate names to numbers
          </button>
        )}
        <ol className="slots">
          {order.map((pid, i) => {
            const p = players.get(pid);
            return (
              <li
                key={pid}
                className={'slot' + (drag?.index === i ? ' dragging' : '') + (pid < 0 ? ' numbered' : '')}
                style={{ transform: `translateY(${shiftFor(i)}px)`, transition: drag?.index === i ? 'none' : undefined }}
              >
                <button
                  className="slot-main"
                  disabled={hasNumbers && !allocating}
                  onClick={() => (allocating ? pid > 0 && unallocate(i) : update(order.filter((x) => x !== pid)))}
                >
                  <span className="slot-no">{i + 1}</span>
                  <span className="slot-name">{fullName(p)}</span>
                  {p?.jersey && <span className="jersey">#{p.jersey}</span>}
                </button>
                <span
                  className="handle"
                  aria-label="Drag to reorder"
                  onPointerDown={(e) => onHandleDown(e, i)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={() => {
                    dragRef.current = null;
                    setDrag(null);
                  }}
                >
                  ≡
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="roster">
        <div className="section-head">
          <h2>{team?.name} roster</h2>
          <button className="link" onClick={() => setAdding(true)}>
            + Add player
          </button>
        </div>
        <input className="search" type="search" placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} />
        {full && <p className="muted hint">{allocating ? 'Every number has a name.' : 'Batting order is full (15).'}</p>}
        <div className="roster-grid">
          {available.map((p) => (
            <button
              key={p.id}
              className="roster-btn"
              disabled={full || (hasNumbers && !allocating)}
              onClick={() => (allocating ? allocate(p.id) : update([...order, p.id]))}
            >
              {fullName(p)}
              {p.jersey && <span className="jersey"> #{p.jersey}</span>}
            </button>
          ))}
          {available.length === 0 && <p className="muted hint">No players match.</p>}
        </div>
      </section>

      <footer className="bottom-bar">
        <button
          className="btn primary big"
          onClick={() => (order.length === 0 ? setAskNoNames(true) : nav({ screen: 'chart', gameId }))}
        >
          {inProgress ? 'Back to chart' : 'Start game'}
        </button>
      </footer>

      {hasNumbers && allocating === null && (
        <Confirm message="Allocate names to numbers?" onNo={() => nav({ screen: 'chart', gameId })} onYes={() => setAllocating(true)} />
      )}
      {askNoNames && (
        <Confirm
          message="Are you sure you just want to do the player order without names?"
          onNo={() => setAskNoNames(false)}
          onYes={async () => {
            await setLineup(gameId, Array.from({ length: batterCount }, (_, i) => -(i + 1)));
            nav({ screen: 'chart', gameId });
          }}
        >
          <div className="stepper-row">
            <span>Batters in their lineup</span>
            <span className="stepper">
              <button onClick={() => setBatterCount((c) => Math.max(1, c - 1))}>−</button>
              <span className="val">{batterCount}</span>
              <button onClick={() => setBatterCount((c) => Math.min(MAX, c + 1))}>+</button>
            </span>
          </div>
        </Confirm>
      )}
      {viewPhoto && photoUrl && <PhotoViewer src={photoUrl} onClose={() => setViewPhoto(false)} />}
      {adding && (
        <AddPlayer
          teamId={game.teamId}
          onClose={() => setAdding(false)}
          onAdded={(p) => {
            setAdding(false);
            if (allocating) allocate(p.id);
            else if (!full) update([...order, p.id]);
          }}
        />
      )}
    </div>
  );
}

export function AddPlayer({ teamId, onClose, onAdded }: { teamId: string; onClose: () => void; onAdded: (p: Player) => void }) {
  const [name, setName] = useState('');
  const [jersey, setJersey] = useState('');
  async function save() {
    const parts = name.trim().split(/\s+/);
    if (!parts[0]) return;
    const p = { teamId, firstName: parts[0], lastName: parts.slice(1).join(' '), jersey: jersey.trim() || undefined };
    const id = (await db.players.add(p as Player)) as number;
    onAdded({ ...p, id });
  }
  return (
    <Sheet title="Add player" onClose={onClose}>
      <label className="field-label">
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" />
      </label>
      <label className="field-label">
        <span>
          Jersey # <span className="muted">(optional)</span>
        </span>
        <input inputMode="numeric" value={jersey} onChange={(e) => setJersey(e.target.value)} />
      </label>
      <button className="btn primary big" disabled={!name.trim()} onClick={save}>
        Add to roster
      </button>
    </Sheet>
  );
}
