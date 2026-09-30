import TeamLogo from './TeamLogo';
import { Trophy } from 'lucide-react';
import type { Action, Match, Tournament } from '../lib/types';
import { aggregate } from '../lib/engine';
import { Empty } from './ui';
import { resolutionLabel, roundLabel } from './Matches';
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
                : roundLabel(t, round).toUpperCase()}
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
                    {tie.resolution && <p className="fine-print">{resolutionLabel(t, tie)}</p>}
                    {agg.complete && agg.a === agg.b && !tie.winner && (
                      <div className="notice">
                        {admin ? 'Open either leg to record the winner.' : 'Awaiting decider — winner required'}
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
    </>
  );
}
