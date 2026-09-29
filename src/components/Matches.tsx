import TeamLogo from './TeamLogo';
import { useEffect, useState } from 'react';
import { Check, Pencil, ArrowRight, Clock } from 'lucide-react';
import type { Action, Match, Tournament } from '../lib/types';
import { aggregate, knockoutResolution, played } from '../lib/engine';
import { ApiError } from '../lib/api';
import { ErrorText, Modal, Empty } from './ui';
export function MatchCard({
  match: m,
  t,
  onOpen,
}: {
  match: Match;
  t: Tournament;
  onOpen: (m: Match) => void;
}) {
  const a = t.players.find((p) => p.id === m.home)!,
    b = t.players.find((p) => p.id === m.away)!;
  const tie = t.ties.find((tie) => tie.id === m.tieId);
  const agg = tie ? aggregate(t, tie) : null;
  const pending = tie && agg?.complete && agg.a === agg.b && !tie.winner;
  return (
    <button className={'match-card ' + (played(m) ? 'finished' : '')} onClick={() => onOpen(m)}>
      <div className="match-meta">
        <span>
          {m.stage === 'league'
            ? `MATCHDAY ${m.matchday}`
            : m.round === Math.log2(t.settings.knockout)
              ? 'FINAL'
              : `KNOCKOUT ROUND ${m.round}`}{' '}
          · LEG {m.leg}
        </span>
        <span className={played(m) ? 'match-done' : 'match-upcoming'}>
          {played(m) ? (
            <>
              <Check size={12} />
              {pending
                ? knockoutResolution(t) === 'penalties'
                  ? 'Awaiting penalties'
                  : 'Awaiting decider'
                : m.leaguePenalties
                  ? `FT · pens ${m.leaguePenalties.home}–${m.leaguePenalties.away}`
                  : 'FT'}
            </>
          ) : (
            <>
              <Clock size={12} />
              Upcoming
            </>
          )}
        </span>
      </div>
      <div className="match-teams">
        <div>
          <span className="avatar">
            <TeamLogo value={a.avatar} />
          </span>
          <strong>{a.name}</strong>
        </div>
        <div className="match-score">
          {played(m) ? (
            <>
              {m.homeScore}
              <span>–</span>
              {m.awayScore}
            </>
          ) : (
            <span className="versus">VS</span>
          )}
        </div>
        <div>
          <span className="avatar">
            <TeamLogo value={b.avatar} />
          </span>
          <strong>{b.name}</strong>
        </div>
      </div>
      <span className="match-footer">
        {played(m) ? 'Match details' : 'View fixture'}
        <ArrowRight size={15} />
      </span>
    </button>
  );
}
export function Matches({ t, onOpen }: { t: Tournament; onOpen: (m: Match) => void }) {
  const [filter, setFilter] = useState('all'),
    [leg, setLeg] = useState('all'),
    [day, setDay] = useState('all'),
    [stage, setStage] = useState('all');
  const list = t.matches.filter(
    (m) =>
      (filter === 'all' || (filter === 'completed') === played(m)) &&
      (leg === 'all' || m.leg === Number(leg)) &&
      (day === 'all' || m.matchday === Number(day)) &&
      (stage === 'all' || m.stage === stage),
  );
  return (
    <>
      <div className="filter-bar">
        <div className="segmented">
          {['all', 'upcoming', 'completed'].map((f) => (
            <button className={filter === f ? 'active' : ''} key={f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="filter-selects">
          <select aria-label="Filter by leg" value={leg} onChange={(e) => setLeg(e.target.value)}>
            <option value="all">All legs</option>
            {Array.from({ length: Math.max(t.settings.repetitions, t.settings.legs) }, (_, i) => (
              <option key={i} value={i + 1}>
                Leg {i + 1}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by matchday"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          >
            <option value="all">All matchdays</option>
            {[...new Set(t.matches.map((m) => m.matchday))]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  Matchday {d}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter by stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="all">All stages</option>
            <option value="league">League</option>
            <option value="knockout">Knockout</option>
          </select>
        </div>
      </div>
      {list.length ? (
        <div className="matches-grid">
          {list.map((m) => (
            <MatchCard key={m.id} match={m} t={t} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <Empty title="No fixtures here yet">
          {t.status === 'setup'
            ? 'The administrator will generate fixtures when the players are ready.'
            : 'Try a different filter.'}
        </Empty>
      )}
    </>
  );
}
export function ScoreModal({
  m,
  t,
  admin,
  onClose,
  onAction,
}: {
  m: Match;
  t: Tournament;
  admin: boolean;
  onClose: () => void;
  onAction: (a: Action, version?: number) => Promise<void>;
}) {
  const a = t.players.find((p) => p.id === m.home) ?? { name: 'Removed player', avatar: '⚽' },
    b = t.players.find((p) => p.id === m.away) ?? { name: 'Removed player', avatar: '⚽' };
  const [home, setHome] = useState(m.homeScore?.toString() ?? ''),
    [away, setAway] = useState(m.awayScore?.toString() ?? ''),
    [penaltiesHome, setPenaltiesHome] = useState(m.leaguePenalties?.home.toString() ?? ''),
    [penaltiesAway, setPenaltiesAway] = useState(m.leaguePenalties?.away.toString() ?? ''),
    [editing, setEditing] = useState(!played(m)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reset, setReset] = useState(false),
    [version, setVersion] = useState(t.version),
    [conflict, setConflict] = useState(false);
  const current = t.matches.find((x) => x.id === m.id);
  const needsLeaguePenalties =
    m.stage === 'league' &&
    t.settings.leagueDrawsAllowed === false &&
    home !== '' &&
    away !== '' &&
    Number(home) === Number(away);
  const missingPolicy = needsLeaguePenalties && !t.settings.leaguePenaltyPoints;
  const policyError =
    'League penalty points are not configured. This tied result cannot be finalized until an explicit points policy is configured.';
  const dirty =
    home !== (m.homeScore?.toString() ?? '') ||
    away !== (m.awayScore?.toString() ?? '') ||
    penaltiesHome !== (m.leaguePenalties?.home.toString() ?? '') ||
    penaltiesAway !== (m.leaguePenalties?.away.toString() ?? '');
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = () => {
    if (!busy && (!dirty || window.confirm('Discard the scores you have not saved?'))) onClose();
  };
  const locked =
    !current ||
    (m.stage === 'league'
      ? !(
          ['league_active', 'league_complete'].includes(t.status) ||
          (t.status === 'completed' && !t.settings.knockout)
        )
      : t.ties.some((tie) => tie.round > m.round));
  const save = async (action: Action) => {
    setBusy(true);
    setError('');
    try {
      await onAction(action, version);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setError(e instanceof Error ? e.message : 'Unable to save. Your entry is preserved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={admin && !locked ? 'Record the result' : 'Match details'} onClose={close}>
      <div className="match-context">
        {m.stage === 'league' ? `League · Matchday ${m.matchday}` : `Knockout · Round ${m.round}`} ·
        Leg {m.leg}
      </div>
      {played(m) && !editing && (
        <div className="notice">This match already has a recorded result.</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !/^\d+$/.test(home) ||
            !/^\d+$/.test(away) ||
            Number(home) > 999 ||
            Number(away) > 999
          ) {
            setError('Enter whole-number scores from 0 to 999.');
            return;
          }
          if (missingPolicy) {
            setError(policyError);
            return;
          }
          if (
            needsLeaguePenalties &&
            (!/^\d+$/.test(penaltiesHome) ||
              !/^\d+$/.test(penaltiesAway) ||
              Number(penaltiesHome) > 999 ||
              Number(penaltiesAway) > 999 ||
              Number(penaltiesHome) === Number(penaltiesAway))
          ) {
            setError('Enter penalty scores from 0 to 999 that determine a winner.');
            return;
          }
          void save({
            type: 'score',
            matchId: m.id,
            home: Number(home),
            away: Number(away),
            confirmEdit: played(m) || Boolean(current && played(current)),
            ...(needsLeaguePenalties
              ? { leaguePenalties: { home: Number(penaltiesHome), away: Number(penaltiesAway) } }
              : {}),
          });
        }}
      >
        <div className="score-entry">
          <label>
            <span className="big-avatar">
              <TeamLogo value={a.avatar} />
            </span>
            <strong>{a.name}</strong>
            {admin && editing && !locked ? (
              <input
                aria-label={`${a.name} score`}
                type="number"
                inputMode="numeric"
                min="0"
                max="999"
                step="1"
                required
                value={home}
                onChange={(e) => setHome(e.target.value)}
              />
            ) : (
              <span className="score-display">{m.homeScore ?? '–'}</span>
            )}
          </label>
          <span className="score-dash">–</span>
          <label>
            <span className="big-avatar">
              <TeamLogo value={b.avatar} />
            </span>
            <strong>{b.name}</strong>
            {admin && editing && !locked ? (
              <input
                aria-label={`${b.name} score`}
                type="number"
                inputMode="numeric"
                min="0"
                max="999"
                step="1"
                required
                value={away}
                onChange={(e) => setAway(e.target.value)}
              />
            ) : (
              <span className="score-display">{m.awayScore ?? '–'}</span>
            )}
          </label>
        </div>
        {needsLeaguePenalties && admin && editing && !locked && (
          <>
            <h3>League penalty shootout</h3>
            <p className="fine-print">
              A tied normal match must have a shootout winner. Penalties do not count toward goals.
            </p>
            <div className="field-row">
              <label>
                {a.name} penalties
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999"
                  step="1"
                  required
                  value={penaltiesHome}
                  onChange={(e) => setPenaltiesHome(e.target.value)}
                />
              </label>
              <label>
                {b.name} penalties
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999"
                  step="1"
                  required
                  value={penaltiesAway}
                  onChange={(e) => setPenaltiesAway(e.target.value)}
                />
              </label>
            </div>
            {missingPolicy ? (
              <div className="notice" role="status">
                {policyError} Normal win/draw/loss points are not a fallback.
              </div>
            ) : (
              <p className="fine-print">
                Explicit league penalty points: winner {t.settings.leaguePenaltyPoints!.winner},
                loser {t.settings.leaguePenaltyPoints!.loser}.
              </p>
            )}
          </>
        )}
        {m.leaguePenalties && !editing && (
          <p className="notice">
            League penalties: {a.name} {m.leaguePenalties.home}–{m.leaguePenalties.away} {b.name}.
            Winner: {m.leaguePenalties.home > m.leaguePenalties.away ? a.name : b.name}.
          </p>
        )}
        {m.updatedAt && (
          <p className="fine-print center">Last updated {new Date(m.updatedAt).toLocaleString()}</p>
        )}
        {admin && !locked && (
          <>
            {editing ? (
              <>
                <p className="fine-print">
                  {played(m)
                    ? 'Changing this result will recalculate standings and statistics.'
                    : 'Check both scores before saving.'}
                  {m.stage === 'knockout' &&
                    ' Include extra-time goals here, but not penalties. If the completed aggregate is tied, the tie remains awaiting a winner: record its decider in Knockout. Every round requires a winner using the configured knockout decider.'}
                </p>
                <button
                  className="button primary full"
                  disabled={busy || conflict || missingPolicy}
                >
                  {busy ? 'Saving result…' : 'Save result'}
                  <Check size={18} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button primary full"
                onClick={() => setEditing(true)}
              >
                <Pencil size={17} />
                Edit result
              </button>
            )}
            {played(m) && (
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => setReset(!reset)}
              >
                Reset this result
              </button>
            )}
            {reset && (
              <div className="danger-box">
                <p>Remove this score? Standings will be recalculated.</p>
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void save({ type: 'resetMatch', matchId: m.id, confirmation: 'RESET' })
                  }
                >
                  Confirm reset
                </button>
              </div>
            )}
          </>
        )}
        {locked && admin && (
          <div className="notice">
            This result is locked because the tournament has advanced. Reset the knockout stage in
            Admin to correct qualification.
          </div>
        )}
        <ErrorText message={error} />
        {conflict && (
          <div className="notice">
            <p>
              Latest saved result: {current?.homeScore ?? '—'} – {current?.awayScore ?? '—'}.{' '}
              {current?.leaguePenalties &&
                `Penalties ${current.leaguePenalties.home}–${current.leaguePenalties.away}. `}
              Your entered scores above are unchanged.
            </p>
            <button
              type="button"
              className="button secondary full"
              onClick={() => {
                setVersion(t.version);
                setConflict(false);
                setError('');
              }}
            >
              I reviewed the latest result; enable save
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
