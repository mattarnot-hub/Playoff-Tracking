import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, exportAll, importAll, sortKey, todayIso, type Player } from '../db';
import type { Nav } from '../App';
import { AddPlayer } from './BattingOrder';
import { getTheme, setTheme, type ThemeChoice } from '../theme';
import Logo from '../components/Logo';

const HOLD_KEY = 'spray.holdMs';
const HOLD_OPTIONS = [1500, 2000, 3000];

export function getHoldMs() {
  try {
    const v = Number(localStorage.getItem(HOLD_KEY));
    if (HOLD_OPTIONS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 1500;
}

export default function Settings({ nav }: { nav: Nav }) {
  const [hold, setHold] = useState(getHoldMs);
  const [theme, setThemeState] = useState(getTheme);
  const [msg, setMsg] = useState('');

  function pickHold(v: number) {
    setHold(v);
    try {
      localStorage.setItem(HOLD_KEY, String(v));
    } catch {
      /* ignore */
    }
  }

  async function doExport() {
    const data = await exportAll();
    const file = new File([JSON.stringify(data)], `spray-chart-backup-${todayIso()}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }

  async function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      await importAll(JSON.parse(await f.text()));
      setMsg('Backup restored.');
    } catch (err) {
      setMsg(`Import failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <Logo />
        <button className="link" onClick={() => nav({ screen: 'setup' })}>
          ‹ Back
        </button>
        <h1 className="title small">Settings</h1>
      </header>

      <section className="settings-section">
        <h2>Appearance</h2>
        <p className="muted">Auto follows the iPhone's light / dark setting.</p>
        <div className="seg">
          {(['auto', 'light', 'dark'] as ThemeChoice[]).map((v) => (
            <button
              key={v}
              className={'seg-btn' + (theme === v ? ' on' : '')}
              onClick={() => {
                setThemeState(v);
                setTheme(v);
              }}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Hit hold time</h2>
        <p className="muted">How long to press and hold on the field to record a hit.</p>
        <div className="seg">
          {HOLD_OPTIONS.map((v) => (
            <button key={v} className={'seg-btn' + (hold === v ? ' on' : '')} onClick={() => pickHold(v)}>
              {v / 1000} s
            </button>
          ))}
        </div>
      </section>

      <RosterEditor />

      <section className="settings-section">
        <h2>Backup</h2>
        <p className="muted">All games, rosters and lineup photos in one JSON file. Importing replaces everything on this phone.</p>
        <div className="row-btns">
          <button className="btn" onClick={doExport}>
            Export all data
          </button>
          <label className="btn">
            Import backup
            <input type="file" accept="application/json,.json" hidden onChange={doImport} />
          </label>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </section>

      <section className="settings-section">
        <h2>Field map</h2>
        <p className="muted">
          The field drawing is <code>public/field.svg</code>. Replace it (keep viewBox 0 0 1000 1000 and home plate at 500, 950) and redeploy —
          existing marks stay in place.
        </p>
      </section>
    </div>
  );
}

function RosterEditor() {
  const teams = useLiveQuery(() => db.teams.orderBy('name').toArray(), []) ?? [];
  const [teamId, setTeamId] = useState('');
  const [adding, setAdding] = useState(false);
  const players = useLiveQuery(
    async () => (teamId ? (await db.players.where('teamId').equals(teamId).toArray()).filter((p) => !p.removed).sort((a, b) => sortKey(a).localeCompare(sortKey(b))) : []),
    [teamId],
  );

  return (
    <section className="settings-section">
      <h2>Rosters</h2>
      <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        <option value="">Choose a team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {teamId && (
        <>
          <div className="roster-edit">
            <div className="re-head">
              <span>First</span>
              <span>Last</span>
              <span>#</span>
              <span />
            </div>
            {players?.map((p) => <PlayerRow key={p.id} p={p} />)}
          </div>
          <button className="btn" onClick={() => setAdding(true)}>
            + Add player
          </button>
          {adding && <AddPlayer teamId={teamId} onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
        </>
      )}
    </section>
  );
}

function PlayerRow({ p }: { p: Player }) {
  const save = (patch: Partial<Player>) => db.players.update(p.id, patch);
  return (
    <div className="re-row">
      <input defaultValue={p.firstName} onBlur={(e) => e.target.value.trim() && save({ firstName: e.target.value.trim() })} />
      <input defaultValue={p.lastName} onBlur={(e) => save({ lastName: e.target.value.trim() })} />
      <input defaultValue={p.jersey ?? ''} inputMode="numeric" onBlur={(e) => save({ jersey: e.target.value.trim() || undefined })} />
      <button className="icon-btn" aria-label={`Remove ${p.firstName}`} onClick={() => save({ removed: true })}>
        ✕
      </button>
    </div>
  );
}
