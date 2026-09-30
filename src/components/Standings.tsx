import TeamLogo from './TeamLogo';
import { memo } from 'react';
import type { Match, Standing, Tournament } from '../lib/types';
import { standings, played } from '../lib/engine';
import { Modal, Empty } from './ui';
import { MatchCard } from './Matches';
export function Form({ values }: { values: Standing['form'] }) {
  return (
    <div className="form-dots">
      {values.length ? (
        values.map((v, i) => (
          <span
            key={i}
            className={'form-' + v}
            title={v === 'W' ? 'Win' : v === 'D' ? 'Draw' : 'Loss'}
          >
            {v}
          </span>
        ))
      ) : (
        <span className="muted">—</span>
      )}
    </div>
  );
}
export const Table = memo(function Table({
  t,
  onPlayer,
  compact = false,
}: {
  t: Tournament;
  onPlayer: (id: string) => void;
  compact?: boolean;
}) {
  const rows = standings(t);
  return (
    <div className="panel table-panel">
      <div className="table-scroll">
        <table>
          <caption className="sr-only">League standings</caption>
          <thead>
            <tr>
              <th>POS</th>
              <th>PLAYER</th>
              <th>P</th>
              {!compact && (
                <>
                  <th>W</th>
                  <th>D</th>
                  <th>L</th>
                  <th>GF</th>
                  <th>GA</th>
                </>
              )}
              <th>GD</th>
              <th>PTS</th>
              {!compact && <th>FORM</th>}
            </tr>
          </thead>
          <tbody>
            {(compact ? rows.slice(0, 5) : rows).map((r, i) => (
              <tr key={r.id} className={t.settings.knockout > i ? 'qualified' : ''}>
                <td>
                  <span className={'rank ' + (i === 0 ? 'first' : '')}>
                    {r.tied ? '=' : r.rank}
                  </span>
                </td>
                <td>
                  <button className="player-button" onClick={() => onPlayer(r.id)}>
                    <span className="table-avatar">
                      <TeamLogo value={r.avatar} />
                    </span>
                    <strong>{r.name}</strong>
                    {r.tied && <small className="tie-label">TIE</small>}
                  </button>
                </td>
                <td>{r.played}</td>
                {!compact && (
                  <>
                    <td>{r.wins}</td>
                    <td>{r.draws}</td>
                    <td>{r.losses}</td>
                    <td>{r.gf}</td>
                    <td>{r.ga}</td>
                  </>
                )}
                <td>
                  {r.gd > 0 ? '+' : ''}
                  {r.gd}
                </td>
                <td className="points">{r.points}</td>
                {!compact && (
                  <td>
                    <Form values={r.form} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.settings.knockout > 0 && (
        <p className="table-note">
          <span />
          Top {t.settings.knockout} qualification positions · provisional until league review
        </p>
      )}
    </div>
  );
});
export const Statistics = memo(function Statistics({
  t,
  onPlayer,
}: {
  t: Tournament;
  onPlayer: (id: string) => void;
}) {
  const rows = standings(t).filter((r) => r.played);
  if (!rows.length)
    return (
      <Empty title="The numbers start at kickoff">
        Statistics will appear once league results are recorded.
      </Empty>
    );
  const metrics: {
    title: string;
    metric: (r: Standing) => number;
    unit: string;
    ascending?: boolean;
  }[] = [
    { title: 'Top scorers / best attack', metric: (r) => r.gf, unit: 'goals' },
    { title: 'Best defence', metric: (r) => r.ga, unit: 'conceded', ascending: true },
    { title: 'Most conceded', metric: (r) => r.ga, unit: 'conceded' },
    { title: 'Best goal difference', metric: (r) => r.gd, unit: 'GD' },
    { title: 'Most wins', metric: (r) => r.wins, unit: 'wins' },
    { title: 'Most draws', metric: (r) => r.draws, unit: 'draws' },
    { title: 'Win rate', metric: (r) => (r.wins / r.played) * 100, unit: '%' },
    { title: 'Points per match', metric: (r) => r.points / r.played, unit: 'PPM' },
    { title: 'Goals per match', metric: (r) => r.gf / r.played, unit: 'GPM' },
  ];
  return (
    <>
      <p className="muted">
        League statistics · team goals, not individual in-game footballers. Only players with
        recorded matches are included.
      </p>
      <div className="stats-grid">
        {metrics.map(({ title, metric, unit, ascending }) => (
          <div className="panel stat-ranking" key={title}>
            <span className="eyebrow">{title}</span>
            {[...rows]
              .sort(
                (a, b) =>
                  (ascending ? 1 : -1) * (metric(a) - metric(b)) || a.name.localeCompare(b.name),
              )
              .slice(0, 3)
              .map((r, i) => (
                <button onClick={() => onPlayer(r.id)} key={r.id}>
                  <span>{i + 1}</span>
                  <span className="table-avatar">
                    <TeamLogo value={r.avatar} />
                  </span>
                  <strong>{r.name}</strong>
                  <b>
                    {Number.isInteger(metric(r)) ? metric(r) : metric(r).toFixed(1)}
                    <small>{unit}</small>
                  </b>
                </button>
              ))}
          </div>
        ))}
      </div>
    </>
  );
});
export function Profile({
  id,
  t,
  onClose,
  onMatch,
}: {
  id: string;
  t: Tournament;
  onClose: () => void;
  onMatch: (m: Match) => void;
}) {
  const r = standings(t).find((r) => r.id === id)!;
  const history = t.matches.filter((m) => played(m) && (m.home === id || m.away === id));
  return (
    <Modal title="Player profile" onClose={onClose}>
      <div className="profile-heading">
        <span className="big-avatar">
          <TeamLogo value={r.avatar} />
        </span>
        <h2>{r.name}</h2>
        <Form values={r.form} />
      </div>
      <div className="profile-stats">
        {[
          ['Points', r.points],
          ['Played', r.played],
          ['Wins', r.wins],
          ['Draws', r.draws],
          ['Losses', r.losses],
          ['Goals', r.gf],
          ['Conceded', r.ga],
          ['GD', r.gd],
          ['Win rate', `${r.played ? ((r.wins / r.played) * 100).toFixed(1) : '0'}%`],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <p className="fine-print">Summary statistics cover the league stage.</p>
      <h3>Match history</h3>
      <div className="profile-history">
        {history.length ? (
          history.map((m) => <MatchCard key={m.id} t={t} match={m} onOpen={onMatch} />)
        ) : (
          <p className="muted">No results have been recorded.</p>
        )}
      </div>
    </Modal>
  );
}
