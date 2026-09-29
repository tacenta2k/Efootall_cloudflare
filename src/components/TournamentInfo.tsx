import type { Tournament } from '../lib/types';
const labels = {
  points: 'Points',
  gd: 'Goal difference',
  gf: 'Goals scored',
  h2h: 'Head-to-head',
  wins: 'Wins',
};
export default function TournamentInfo({ tournament: t }: { tournament: Tournament }) {
  return (
    <details className="panel tournament-info">
      <summary>Tournament information & rules</summary>
      <dl className="review-list">
        <div>
          <dt>League format</dt>
          <dd>{t.settings.repetitions} matches per opponent</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>
            Win {t.settings.win} · Draw {t.settings.draw} · Loss {t.settings.loss}
          </dd>
        </div>
        <div>
          <dt>League draws</dt>
          <dd>
            {t.settings.leagueDrawsAllowed === false
              ? 'Penalty shootout required'
              : 'Draws allowed'}
          </dd>
        </div>
        {t.settings.leagueDrawsAllowed === false && (
          <div>
            <dt>League penalty points</dt>
            <dd>
              {t.settings.leaguePenaltyPoints
                ? `Winner ${t.settings.leaguePenaltyPoints.winner} · Loser ${t.settings.leaguePenaltyPoints.loser}`
                : 'Not configured — tied league results cannot be finalized yet'}
            </dd>
          </div>
        )}
        <div>
          <dt>Tie-break order</dt>
          <dd>{t.settings.tieRules.map((rule) => labels[rule]).join(' → ')}</dd>
        </div>
        <div>
          <dt>Knockout</dt>
          <dd>
            {t.settings.knockout
              ? `Top ${t.settings.knockout} · ${t.settings.legs === 2 ? 'Two legs, including final' : 'Single leg'}`
              : 'League winner becomes champion'}
          </dd>
        </div>
        {t.settings.knockout > 0 && (
          <div>
            <dt>Knockout tied scores (all rounds)</dt>
            <dd>
              {t.settings.resolution === 'either'
                ? 'Penalties or admin-confirmed winner'
                : t.settings.resolution === 'penalties'
                  ? 'Penalty shootout'
                  : 'Admin-confirmed winner'}{' '}
              · no away goals
            </dd>
          </div>
        )}
      </dl>
      <p className="fine-print">
        Scores include extra-time goals. Penalties are separate. Final league standings require
        administrator review before qualification. All timestamps are displayed in your local time.
      </p>
    </details>
  );
}
