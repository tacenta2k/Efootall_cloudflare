import TeamLogo from './TeamLogo';
import { memo, useEffect, useMemo, useState } from 'react';
import { Check, Pencil, ArrowRight, Clock } from 'lucide-react';
import type { Action, Match, Tie, Tournament } from '../lib/types';
import { aggregate, knockoutResolution, played } from '../lib/engine';
import { ApiError } from '../lib/api';
import { registerNavigationGuard } from '../lib/navigation';
import { ErrorText, Modal, Empty } from './ui';
export function roundLabel(t: Tournament, round: number) {
  const remaining = Math.log2(t.settings.knockout) - round;
  return remaining === 0 ? 'Final' : remaining === 1 ? 'Semi-finals' : remaining === 2 ? 'Quarter-finals' : `Round of ${2 ** (remaining + 1)}`;
}
export function resolutionLabel(t: Tournament, tie: Tie) {
  const r = tie.resolution;
  if (!r) return '';
  const name = (id: string) => t.players.find((p) => p.id === id)?.name ?? 'Removed player';
  const result = r.method === 'penalties'
    ? `${name(tie.a)} ${r.penaltiesA}–${r.penaltiesB} ${name(tie.b)} on penalties · ${name(r.winner)} wins`
    : r.method === 'manual' ? `${name(r.winner)} wins · confirmed by admin` : `${name(r.winner)} wins on score`;
  return result + (r.extraTime ? ' · after extra time' : '');
}
// Snapshots are immutable. Share one lookup across every card for that player
// array; WeakMap permits old snapshots to be collected after refreshes.
const playerLookups = new WeakMap<Tournament['players'], Map<string, Tournament['players'][number]>>();
function playersById(players: Tournament['players']) {
  let lookup = playerLookups.get(players);
  if (!lookup) {
    lookup = new Map(players.map((player) => [player.id, player]));
    playerLookups.set(players, lookup);
  }
  return lookup;
}
export const MatchCard = memo(function MatchCard({
  match: m,
  t,
  onOpen,
}: {
  match: Match;
  t: Tournament;
  onOpen: (m: Match) => void;
}) {
  const players = playersById(t.players);
  const a = players.get(m.home)!,
    b = players.get(m.away)!;
  const tie = t.ties.find((tie) => tie.id === m.tieId);
  const agg = tie ? aggregate(t, tie) : null;
  const pending = tie && agg?.complete && agg.a === agg.b && !tie.winner;
  return (
    <button className={'match-card ' + (played(m) ? 'finished' : '')} onClick={() => onOpen(m)}>
      <div className="match-meta">
        <span>
          {m.stage === 'league'
            ? `MATCHDAY ${m.matchday}`
            : roundLabel(t, m.round).toUpperCase()}{' '}
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
      {tie?.resolution && <span className="fine-print">Tie result: {resolutionLabel(t, tie)}</span>}
      <span className="match-footer">
        {played(m) ? 'Match details' : 'View fixture'}
        <ArrowRight size={15} />
      </span>
    </button>
  );
});
export const Matches = memo(function Matches({ t, onOpen }: { t: Tournament; onOpen: (m: Match) => void }) {
  const [filter, setFilter] = useState('all'),
    [leg, setLeg] = useState('all'),
    [day, setDay] = useState('all'),
    [stage, setStage] = useState('all'),
    [round, setRound] = useState('all');
  const list = useMemo(() => t.matches.filter(
    (m) =>
      (filter === 'all' || (filter === 'completed') === played(m)) &&
      (stage !== 'league' || leg === 'all' || m.leg === Number(leg)) &&
      (stage !== 'league' || day === 'all' || m.matchday === Number(day)) &&
      (stage !== 'knockout' || round === 'all' || m.round === Number(round)) &&
      (stage === 'all' || m.stage === stage),
  ), [t.matches, filter, stage, leg, day, round]);
  const matchdays = useMemo(() => [...new Set(t.matches.filter((m) => m.stage === 'league').map((m) => m.matchday))]
    .sort((a, b) => a - b), [t.matches]);
  const groups = useMemo(() => (['league', 'knockout'] as const).map((s) => ({
    stage: s, games: list.filter((m) => m.stage === s),
  })), [list]);
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
          <label>Stage
            <select aria-label="Filter by stage" value={stage} onChange={(e) => {
              setStage(e.target.value); setLeg('all'); setDay('all'); setRound('all');
            }}>
              <option value="all">All stages</option>
              <option value="league">League</option>
              <option value="knockout">Knockout</option>
            </select>
          </label>
          {stage === 'league' && <>
          <select aria-label="Filter by leg" value={leg} onChange={(e) => setLeg(e.target.value)}>
            <option value="all">All legs</option>
            {Array.from({ length: t.settings.repetitions }, (_, i) => (
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
            {matchdays.map((d) => (
                <option key={d} value={d}>
                  Matchday {d}
                </option>
              ))}
          </select>
          </>}
          {stage === 'knockout' && <label>Round
            <select aria-label="Filter by knockout round" value={round} onChange={(e) => setRound(e.target.value)}>
              <option value="all">All rounds</option>
              {Array.from({ length: Math.log2(t.settings.knockout || 1) }, (_, i) => i + 1).map((r) => <option key={r} value={r}>{roundLabel(t, r)}</option>)}
            </select>
          </label>}
        </div>
      </div>
      {list.length ? (
        <>{groups.map(({ stage: s, games }) => {
          return games.length ? <section key={s}>
            {stage === 'all' && <h3>{s === 'league' ? 'League' : 'Knockout'}</h3>}
            <div className="matches-grid">{games.map((m) => <MatchCard key={m.id} match={m} t={t} onOpen={onOpen} />)}</div>
          </section> : null;
        })}</>
      ) : (
        <Empty title="No fixtures here yet">
          {t.status === 'setup'
            ? 'The administrator will generate fixtures when the players are ready.'
            : 'Try a different filter.'}
        </Empty>
      )}
    </>
  );
});
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
  const tie = t.ties.find((x) => x.id === m.tieId);
  const [initialResolution] = useState(tie?.resolution);
  const configuredMethod = knockoutResolution(t);
  const initialMethod = initialResolution?.method === 'manual' ? 'manual' : 'penalties';
  const [method, setMethod] = useState<'penalties' | 'manual'>(configuredMethod === 'either' ? initialMethod : configuredMethod);
  const [winner, setWinner] = useState(initialResolution?.winner ?? '');
  const [extraTime, setExtraTime] = useState(initialResolution?.extraTime ?? false);
  const initialHomePens = initialResolution?.method === 'penalties' ? (m.home === tie?.a ? initialResolution.penaltiesA : initialResolution.penaltiesB)?.toString() ?? '' : '';
  const initialAwayPens = initialResolution?.method === 'penalties' ? (m.away === tie?.a ? initialResolution.penaltiesA : initialResolution.penaltiesB)?.toString() ?? '' : '';
  const [knockoutHome, setKnockoutHome] = useState(initialHomePens);
  const [knockoutAway, setKnockoutAway] = useState(initialAwayPens);
  const [home, setHome] = useState(m.homeScore?.toString() ?? ''),
    [away, setAway] = useState(m.awayScore?.toString() ?? ''),
    [penaltiesHome, setPenaltiesHome] = useState(m.leaguePenalties?.home.toString() ?? ''),
    [penaltiesAway, setPenaltiesAway] = useState(m.leaguePenalties?.away.toString() ?? ''),
    [editing, setEditing] = useState(!played(m) || Boolean(tie && aggregate(t, tie).complete && !tie.winner)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reset, setReset] = useState(false),
    [version, setVersion] = useState(t.version),
    [conflict, setConflict] = useState(false);
  const current = t.matches.find((x) => x.id === m.id);
  const validScores = /^\d+$/.test(home) && /^\d+$/.test(away) && Number(home) <= 999 && Number(away) <= 999;
  const projected = tie && validScores ? aggregate({ ...t, matches: t.matches.map((x) => x.id === m.id ? { ...x, homeScore: Number(home), awayScore: Number(away) } : x) }, tie) : null;
  const needsKnockoutDecider = Boolean(projected?.complete && projected.a === projected.b);
  const effectiveMethod = configuredMethod === 'either' ? method : configuredMethod;
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
    method !== (configuredMethod === 'either' ? initialMethod : configuredMethod) ||
    winner !== (initialResolution?.winner ?? '') ||
    extraTime !== (initialResolution?.extraTime ?? false) ||
    knockoutHome !== initialHomePens || knockoutAway !== initialAwayPens ||
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
  const confirmLeave = () =>
    !busy && (!dirty || window.confirm('Discard the scores you have not saved?'));
  useEffect(() => registerNavigationGuard(confirmLeave), [busy, dirty]);
  const close = () => {
    if (confirmLeave()) onClose();
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
        {m.stage === 'league' ? `League · Matchday ${m.matchday}` : `Knockout · ${roundLabel(t, m.round)}`} ·
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
          if (needsKnockoutDecider && (effectiveMethod === 'penalties'
            ? !/^\d+$/.test(knockoutHome) || !/^\d+$/.test(knockoutAway) || Number(knockoutHome) > 999 || Number(knockoutAway) > 999 || Number(knockoutHome) === Number(knockoutAway)
            : winner !== tie?.a && winner !== tie?.b)) {
            setError(effectiveMethod === 'penalties' ? 'Enter penalty scores from 0 to 999 that determine a winner.' : 'Select the confirmed winner.');
            return;
          }
          void save({
            type: 'score',
            matchId: m.id,
            home: Number(home),
            away: Number(away),
            confirmEdit: played(m) || Boolean(current && played(current)),
            ...(m.stage === 'knockout' ? { extraTime } : {}),
            ...(needsKnockoutDecider && tie ? { knockoutResolution: {
              method: effectiveMethod,
              winner: effectiveMethod === 'penalties' ? (Number(knockoutHome) > Number(knockoutAway) ? m.home : m.away) : winner,
              ...(effectiveMethod === 'penalties' ? {
                penaltiesA: Number(m.home === tie.a ? knockoutHome : knockoutAway),
                penaltiesB: Number(m.home === tie.b ? knockoutHome : knockoutAway),
              } : {}),
              extraTime,
            } } : {}),
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
        {tie && admin && editing && !locked && <>
          {projected && <p className="notice">{t.settings.legs === 1 ? 'Result' : 'Aggregate'}: {t.players.find((p) => p.id === tie.a)?.name} {projected.a}–{projected.b} {t.players.find((p) => p.id === tie.b)?.name}{!projected.complete && ' · awaiting remaining leg'}</p>}
          <label className="checkbox-label">
            <input type="checkbox" checked={extraTime} onChange={(e) => setExtraTime(e.target.checked)} />
            Extra time was played
          </label>
          <p className="fine-print">Include extra-time goals in the match scores above. Penalties do not count toward goals.</p>
          {needsKnockoutDecider && <>
            <h3>{t.settings.legs === 1 ? 'Tied result' : 'Tied aggregate'} · winner required</h3>
            <label>Decider
              <select value={effectiveMethod} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {configuredMethod !== 'manual' && <option value="penalties">Penalty shootout</option>}
                {configuredMethod !== 'penalties' && <option value="manual">Manual winner selection</option>}
              </select>
            </label>
            {effectiveMethod === 'penalties' ? <div className="field-row">
              <label>{a.name} penalties<input type="number" inputMode="numeric" min="0" max="999" step="1" required value={knockoutHome} onChange={(e) => setKnockoutHome(e.target.value)} /></label>
              <label>{b.name} penalties<input type="number" inputMode="numeric" min="0" max="999" step="1" required value={knockoutAway} onChange={(e) => setKnockoutAway(e.target.value)} /></label>
            </div> : <label>Confirmed winner<select required value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="">Select winner</option>
              <option value={m.home}>{a.name}</option><option value={m.away}>{b.name}</option>
            </select></label>}
          </>}
        </>}
        {tie && (!editing || !admin || locked) && <p className="notice">
          {t.settings.legs === 1 ? 'Result' : 'Aggregate'}: {t.players.find((p) => p.id === tie.a)?.name} {aggregate(t, tie).a}–{aggregate(t, tie).b} {t.players.find((p) => p.id === tie.b)?.name}.
          {' '}{resolutionLabel(t, tie)}
          {aggregate(t, tie).complete && !tie.winner && ' Awaiting decider — winner required.'}
        </p>}
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
                    ' A completed tied result requires the decider above. Scores and winner are saved together.'}
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
               {tie && resolutionLabel(t, tie)}{' '}
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
