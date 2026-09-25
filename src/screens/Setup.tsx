import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FIELDS, fmtDate, OUR_TEAM, todayIso } from '../db';
import type { Nav } from '../App';

export default function Setup({ nav }: { nav: Nav }) {
  const teams = useLiveQuery(() => db.teams.orderBy('name').toArray(), []) ?? [];
  const games = useLiveQuery(() => db.games.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const lineupCounts = useLiveQuery(async () => {
    const slots = await db.lineupSlots.toArray();
    const m = new Map<number, number>();
    slots.forEach((s) => m.set(s.gameId, (m.get(s.gameId) ?? 0) + 1));
    return m;
  }, []);

  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [field, setField] = useState('');

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '';
  const live = games.find((g) => g.status === 'live');
  const past = games.filter((g) => g.status === 'final').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  async function next() {
    const id = await db.games.add({
      teamId,
      date,
      field: field || undefined,
      ourScore: 0,
      theirScore: 0,
      inning: 1,
      status: 'live',
      createdAt: Date.now(),
    } as never);
    nav({ screen: 'order', gameId: id as number });
  }

  function resume() {
    if (!live) return;
    const hasLineup = (lineupCounts?.get(live.id) ?? 0) > 0;
    nav({ screen: hasLineup ? 'chart' : 'order', gameId: live.id });
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="title">
          {OUR_TEAM} vs. {teamId ? teamName(teamId) : '…'}
        </h1>
        <button className="icon-btn" aria-label="Settings" onClick={() => nav({ screen: 'settings' })}>
          ⚙︎
        </button>
      </header>

      {live && (
        <button className="resume" onClick={resume}>
          <span>
            Resume {OUR_TEAM} vs. {teamName(live.teamId)}, {fmtDate(live.date)}
          </span>
          <span aria-hidden>›</span>
        </button>
      )}

      <div className="form">
        <label className="field-label">
          Opponent
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="" disabled>
              Choose opponent
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} />
        </label>

        <label className="field-label">
          <span>
            Field <span className="muted">(optional)</span>
          </span>
          <select value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">—</option>
            {FIELDS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>

        <button className="btn primary big" disabled={!teamId} onClick={next}>
          Next
        </button>
      </div>

      {past.length > 0 && (
        <section className="past">
          <h2>Past games</h2>
          {past.map((g) => (
            <button key={g.id} className="past-row" onClick={() => nav({ screen: 'chart', gameId: g.id })}>
              {fmtDate(g.date)} · vs. {teamName(g.teamId)} · {g.ourScore}–{g.theirScore}
              <span aria-hidden>›</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
