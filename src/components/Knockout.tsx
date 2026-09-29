import TeamLogo from './TeamLogo';
import { useState } from 'react';
import { Trophy } from 'lucide-react';
import type { Action, Match, Tie, Tournament } from '../lib/types';
import { aggregate, knockoutResolution } from '../lib/engine';
import { Empty, ErrorText, Modal } from './ui';
export default function Knockout({
  t,
  admin,
  onMatch,
  onAction,
}: {
  t: Tournament;
  admin: boolean;
  onMatch: (m: Match) => void;
  onAction: (a: Action) => Promise<void>;
}) {
  const [resolve, setResolve] = useState<Tie | null>(null);
  if (!t.settings.knockout)
    return (
      <Empty title="A league race, all the way">
        The league winner will be crowned champion after the administrator reviews the final table.
      </Empty>
    );
  if (!t.ties.length)
    return (
      <Empty title="The road to the trophy awaits">
        The top {t.settings.knockout} qualify. Once the league is complete, the administrator
        reviews the table and starts the knockout stage.
      </Empty>
    );
  const rounds = Array.from({ length: Math.log2(t.settings.knockout) }, (_, i) => i + 1);
  return (
    <>
      <div className="bracket">
        {rounds.map((round) => (
          <section className="bracket-round" key={round}>
            <span className="eyebrow">
              {round === rounds.length
                ? 'THE FINAL'
                : round === rounds.length - 1
                  ? 'SEMI-FINALS'
                  : 'QUARTER-FINALS'}
            </span>
            {t.ties
              .filter((tie) => tie.round === round)
              .map((tie) => {
                const a = t.players.find((p) => p.id === tie.a)!,
                  b = t.players.find((p) => p.id === tie.b)!,
                  agg = aggregate(t, tie);
                return (
                  <div className="panel bracket-tie" key={tie.id}>
                    <span className="match-meta">
                      TIE {tie.position + 1} · {t.settings.legs === 2 ? 'AGGREGATE' : 'SINGLE LEG'}
                    </span>
                    {[a, b].map((p, i) => (
                      <div
                        className={'bracket-player ' + (tie.winner === p.id ? 'winner' : '')}
                        key={p.id}
                      >
                        <span>
                          <TeamLogo value={p.avatar} />
                        </span>
                        <strong>{p.name}</strong>
                        {tie.winner === p.id && <Trophy size={14} />}
                        <b>{i === 0 ? agg.a : agg.b}</b>
                      </div>
                    ))}
                    <div className="tie-legs">
                      {t.matches
                        .filter((m) => m.tieId === tie.id)
                        .map((m) => (
                          <button key={m.id} className="text-button" onClick={() => onMatch(m)}>
                            Leg {m.leg}
                            <span>
                              {m.homeScore ?? '–'} : {m.awayScore ?? '–'}
                            </span>
                          </button>
                        ))}
                    </div>
                    {tie.resolution && (
                      <p className="fine-print">
                        {tie.resolution.method === 'penalties'
                          ? `Penalties ${tie.resolution.penaltiesA}–${tie.resolution.penaltiesB} (in player order above)`
                          : 'Winner confirmed by admin'}
                        {tie.resolution.extraTime ? ' · after extra time' : ''}
                      </p>
                    )}
                    {agg.complete && agg.a === agg.b && !tie.winner && (
                      <div className="notice">
                        {knockoutResolution(t) === 'penalties'
                          ? 'Awaiting penalties — winner required'
                          : 'Awaiting decider — winner required'}
                        {admin && (
                          <button className="button primary full" onClick={() => setResolve(tie)}>
                            Resolve tied score
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            {!t.ties.some((tie) => tie.round === round) && (
              <div className="panel bracket-placeholder">
                <Trophy />
                <p>Winners of the previous round</p>
                <span>Awaiting qualification</span>
              </div>
            )}
          </section>
        ))}
      </div>
      {resolve && (
        <Decider t={t} tie={resolve} onClose={() => setResolve(null)} onAction={onAction} />
      )}
    </>
  );
}
function Decider({
  t,
  tie,
  onClose,
  onAction,
}: {
  t: Tournament;
  tie: Tie;
  onClose: () => void;
  onAction: (a: Action) => Promise<void>;
}) {
  const resolution = knockoutResolution(t);
  const [method, setMethod] = useState<'penalties' | 'manual'>(
      resolution === 'manual' ? 'manual' : 'penalties',
    ),
    [winner, setWinner] = useState(tie.a),
    [a, setA] = useState(''),
    [b, setB] = useState(''),
    [extra, setExtra] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="Settle the tie"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        The aggregate is level.{' '}
        {resolution === 'penalties'
          ? 'A penalty shootout is required to determine the winner.'
          : 'Record the actual decider; a winner is required.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onAction({
              type: 'resolveTie',
              tieId: tie.id,
              method,
              winner: method === 'penalties' ? (Number(a) > Number(b) ? tie.a : tie.b) : winner,
              ...(method === 'penalties' ? { penaltiesA: Number(a), penaltiesB: Number(b) } : {}),
              extraTime: extra,
            });
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to save decider.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Decider
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {resolution !== 'manual' && <option value="penalties">Penalty shootout</option>}
            {resolution !== 'penalties' && <option value="manual">Manual winner selection</option>}
          </select>
        </label>
        {method === 'penalties' ? (
          <div className="field-row">
            {[tie.a, tie.b].map((id, i) => (
              <label key={id}>
                {t.players.find((p) => p.id === id)!.name} penalties
                <input
                  type="number"
                  min="0"
                  max="999"
                  step="1"
                  required
                  value={i === 0 ? a : b}
                  onChange={(e) => (i === 0 ? setA : setB)(e.target.value)}
                />
              </label>
            ))}
          </div>
        ) : (
          <label>
            Confirmed winner
            <select value={winner} onChange={(e) => setWinner(e.target.value)}>
              {[tie.a, tie.b].map((id) => (
                <option key={id} value={id}>
                  {t.players.find((p) => p.id === id)!.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="checkbox-label">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
          Extra time was played
        </label>
        <p className="fine-print">
          Any extra-time goals must already be included in the match score.
        </p>
        <ErrorText message={error} />
        <button className="button primary full" disabled={busy}>
          {busy ? 'Saving decider…' : 'Confirm winner'}
        </button>
      </form>
    </Modal>
  );
}
