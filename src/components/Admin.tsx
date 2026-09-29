import LogoPicker from './LogoPicker';
import { useState } from 'react';
import { Play, Settings2, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import type { Action, Tournament } from '../lib/types';
import { standings, played } from '../lib/engine';
import { getAudit, TournamentConflictError } from '../lib/api';
import { reconcileSettings } from '../lib/settingsConflict';
import { PlayerFields, RulesFields, KnockoutDeciderFields, knockoutFormats } from './Wizard';
import { ErrorText, Modal } from './ui';
export default function Admin({
  t,
  onAction,
  onMatches,
}: {
  t: Tournament;
  onAction: (a: Action, version?: number) => Promise<void>;
  onMatches: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(t.settings),
    [draftVersion, setDraftVersion] = useState(t.version),
    [draftBase, setDraftBase] = useState({ settings: t.settings, players: t.players }),
    [needsReview, setNeedsReview] = useState(false),
    [players, setPlayers] = useState(t.players),
    [scope, setScope] = useState<'league' | 'knockout' | 'tournament' | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [history, setHistory] = useState<Awaited<ReturnType<typeof getAudit>>['history'] | null>(null),
    [order, setOrder] = useState(() => standings(t).map((r) => r.id));
  const run = async (a: Action) => {
    if (a.type === 'settings' && needsReview) return;
    setBusy(true);
    setError('');
    try {
      await onAction(a, a.type === 'settings' ? draftVersion : undefined);
      if (a.type === 'settings') {
        setDraftVersion(draftVersion + 1);
        setDraftBase({ settings: a.settings, players: a.players });
      }
      setScope(null);
      setConfirmation('');
    } catch (e) {
      if (a.type === 'settings' && e instanceof TournamentConflictError) {
        const latest = e.snapshot.tournament;
        const reconciled = reconcileSettings(draftBase, a, latest);
        setSettings(reconciled.settings);
        setPlayers(reconciled.players);
        setDraftBase({ settings: latest.settings, players: latest.players });
        setDraftVersion(latest.version);
        setNeedsReview(true);
        setError(
          'Settings changed on another device. Latest values are loaded; your edits to unchanged fields were kept. Newer server values take precedence where both changed. Review the form before saving again.',
        );
        return;
      }
      setError(e instanceof Error ? e.message : 'Unable to save.');
      if (a.type === 'avatar') throw e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-layout">
      <div>
        <div className="panel admin-summary">
          <span className="eyebrow">MATCHDAY CONTROL</span>
          <h2>You’re in the dugout.</h2>
          <p className="muted">
            {t.matches.filter(played).length} results recorded ·{' '}
            {t.matches.filter((m) => !played(m)).length} matches remaining
          </p>
          {t.status === 'setup' ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run({ type: 'start' })}
            >
              <Play size={17} />
              Generate fixtures & start league
            </button>
          ) : (
            <button className="button primary" onClick={onMatches}>
              Manage matches
            </button>
          )}
          {t.status === 'league_complete' && (
            <div className="notice">
              <h3>League stage complete</h3>
              <p>
                Review the table before confirming qualification. League results will then be
                locked.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void run({ type: 'advance' })}
              >
                {t.settings.knockout ? 'Confirm & start knockout' : 'Confirm league champion'}
              </button>
            </div>
          )}
        </div>
        {t.status === 'league_complete' && standings(t).some((r) => r.tied) && (
          <div className="panel admin-panel">
            <h3>Resolve complete ties</h3>
            <p className="muted">
              Reorder only players in a tied group. The server will reject changes to positions
              settled by the rules.
            </p>
            <div className="rule-list">
              {order.map((id, i) => (
                <div key={id}>
                  <span>{i + 1}</span>
                  <strong>{t.players.find((p) => p.id === id)?.name}</strong>
                  {[-1, 1].map((d) => (
                    <button
                      className="icon-button"
                      key={d}
                      aria-label={`Move ${t.players.find((p) => p.id === id)?.name} ${d === -1 ? 'up' : 'down'}`}
                      disabled={i + d < 0 || i + d >= order.length}
                      onClick={() => {
                        const n = [...order];
                        [n[i], n[i + d]] = [n[i + d], n[i]];
                        setOrder(n);
                      }}
                    >
                      {d === -1 ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run({ type: 'resolveOrder', order })}
            >
              Confirm tied positions
            </button>
          </div>
        )}
        <div className="panel admin-panel">
          <h3>
            <Settings2 size={19} />
            Tournament settings
          </h3>
          {t.status === 'setup' ? (
            <>
              <label>
                Tournament name
                <input
                  value={settings.name}
                  maxLength={70}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                />
              </label>
              <PlayerFields
                players={players}
                onChange={(p) => {
                  setPlayers(p);
                  if (settings.knockout > p.length) setSettings({ ...settings, knockout: 0 });
                }}
              />
              <h3>Knockout rules & format</h3>
              <div className="field-row">
                <label>
                  Matches per opponent
                  <select
                    value={settings.repetitions}
                    onChange={(e) =>
                      setSettings({ ...settings, repetitions: Number(e.target.value) })
                    }
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Knockout qualification
                  <select
                    value={settings.knockout}
                    onChange={(e) => setSettings({ ...settings, knockout: Number(e.target.value) })}
                  >
                    {knockoutFormats.map(({ size, title }) => (
                      <option key={size} value={size} disabled={size > players.length}>
                        {title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Knockout legs
                  <select
                    value={settings.legs}
                    onChange={(e) => setSettings({ ...settings, legs: Number(e.target.value) })}
                  >
                    <option>1</option>
                    <option>2</option>
                  </select>
                </label>
              </div>
              <KnockoutDeciderFields settings={settings} setSettings={setSettings} />
              <RulesFields settings={settings} setSettings={setSettings} />
              <button
                className="button primary"
                disabled={busy || needsReview}
                onClick={() => void run({ type: 'settings', settings, players })}
              >
                Save settings
              </button>
              {needsReview && (
                <button className="button secondary" onClick={() => setNeedsReview(false)}>
                  I reviewed the refreshed settings; enable save
                </button>
              )}
            </>
          ) : (
            <>
              <p className="muted">
                Format and player names are locked after kickoff. Avatars can still be changed.
              </p>
              {t.players.map((p) => (
                <div className="avatar-edit" key={p.id}>
                  {p.name}
                  <LogoPicker
                    label={`${p.name} avatar`}
                    value={p.avatar}
                    disabled={busy}
                    onChange={(avatar) => run({ type: 'avatar', playerId: p.id, avatar })}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div>
        <div className="panel admin-panel">
          <h3>Result history</h3>
          <p className="muted">
            Changes are recorded with server timestamps and previous tournament snapshots.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setHistory((await getAudit(t.code)).history);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Unable to load history.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Load latest activity
          </button>
          {history && (
            <div className="audit-list">
              {history.length ? (
                history.map((h) => (
                  <div key={h.id}>
                    <strong>
                      {h.action.type === 'score'
                        ? `Score recorded: ${h.action.home}–${h.action.away}`
                        : h.action.type}
                    </strong>
                    <small>{new Date(h.created_at).toLocaleString()}</small>
                  </div>
                ))
              ) : (
                <p>No changes yet.</p>
              )}
            </div>
          )}
        </div>
        <div className="panel admin-panel danger-zone">
          <h3>
            <AlertTriangle size={19} />
            Danger zone
          </h3>
          <p className="muted">
            Resets cannot be undone from the app. Every reset is recorded in the audit history.
          </p>
          {(['knockout', 'league', 'tournament'] as const).map((s) => (
            <button
              className="button secondary danger-text full"
              key={s}
              onClick={() => {
                setScope(s);
                setConfirmation('');
              }}
            >
              Reset {s === 'league' ? 'all results' : s}
            </button>
          ))}
        </div>
        <ErrorText message={error} />
      </div>
      {scope && (
        <Modal
          title={`Reset ${scope}?`}
          onClose={() => {
            if (!busy) setScope(null);
          }}
        >
          <p className="muted">
            {scope === 'tournament'
              ? 'All fixtures and results will be removed. Players and settings remain so you can set up again.'
              : scope === 'league'
                ? 'All league and knockout results will be removed. League fixtures remain.'
                : 'All knockout fixtures and results will be removed. League results remain for review.'}
          </p>
          <label>
            Type RESET to confirm
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <ErrorText message={error} />
          <button
            className="button danger full"
            disabled={confirmation !== 'RESET' || busy}
            onClick={() => void run({ type: 'reset', scope, confirmation: 'RESET' })}
          >
            {busy ? 'Resetting…' : 'Confirm reset'}
          </button>
        </Modal>
      )}
    </div>
  );
}
