import LogoPicker from './LogoPicker';
import TeamLogo from './TeamLogo';
import { emojis } from '../lib/logos';
import { discardLogo } from '../lib/logoUpload';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Trash2,
  Trophy,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { create, auth } from '../lib/api';
import { defaultSettings, type Player, type Settings, type TieRule } from '../lib/types';
import { setupSchema } from '../lib/validation';
import { Brand, ErrorText } from './ui';
export const ruleNames: Record<TieRule, string> = {
  points: 'Points',
  gd: 'Goal difference',
  gf: 'Goals scored',
  h2h: 'Head-to-head mini-table',
  wins: 'Wins',
};
export { emojis } from '../lib/logos';
export function PlayerFields({
  players,
  onChange,
}: {
  players: Player[];
  onChange: (p: Player[]) => void;
}) {
  return (
    <div className="player-fields">
      {players.map((p, i) => (
        <div className="player-input" key={p.id}>
          <span className="player-index">{String(i + 1).padStart(2, '0')}</span>
          <LogoPicker
            value={p.avatar}
            label={`Player ${i + 1} avatar`}
            onChange={(avatar) =>
              onChange(players.map((x) => (x.id === p.id ? { ...x, avatar } : x)))
            }
          />
          <label className="name-label">
            <span className="sr-only">Player {i + 1} name</span>
            <input
              placeholder={`Player ${i + 1} name`}
              maxLength={48}
              value={p.name}
              onChange={(e) =>
                onChange(players.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))
              }
            />
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove player ${i + 1}`}
            disabled={players.length <= 2}
            onClick={() => {
              void discardLogo(p.avatar);
              onChange(players.filter((x) => x.id !== p.id));
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary full"
        disabled={players.length >= 32}
        onClick={() =>
          onChange([
            ...players,
            { id: crypto.randomUUID(), name: '', avatar: emojis[players.length % emojis.length] },
          ])
        }
      >
        <Plus size={17} />
        Add player
      </button>
    </div>
  );
}
export function RulesFields({
  settings: s,
  setSettings,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  return (
    <>
      <h3>League / normal match rules</h3>
      <div className="field-row">
        {(['win', 'draw', 'loss'] as const).map((k) => (
          <label key={k}>
            {k} points
            <input
              type="number"
              min={0}
              max={20}
              value={s[k]}
              onChange={(e) => setSettings({ ...s, [k]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <fieldset className="panel">
        <legend>Can normal/league matches end in a draw?</legend>
        <label className="checkbox-label">
          <input
            type="radio"
            name="league-draws"
            checked={s.leagueDrawsAllowed !== false}
            onChange={() => setSettings({ ...s, leagueDrawsAllowed: true })}
          />
          Yes — Draws are allowed
        </label>
        <label className="checkbox-label">
          <input
            type="radio"
            name="league-draws"
            checked={s.leagueDrawsAllowed === false}
            onChange={() => setSettings({ ...s, leagueDrawsAllowed: false })}
          />
          No — Penalty shootout required
        </label>
      </fieldset>
      <p className="fine-print">
        This setting applies only to league / normal matches. It does not control knockout matches.
      </p>
      {s.leagueDrawsAllowed === false && (
        <div className="notice">
          {s.leaguePenaltyPoints
            ? `League penalty points: winner ${s.leaguePenaltyPoints.winner}, loser ${s.leaguePenaltyPoints.loser}.`
            : 'League penalty points are not configured. You can save this setup, but tied league results cannot be finalized until an explicit penalty-points policy is configured. Normal win/draw/loss points will not be used as a fallback.'}
        </div>
      )}
      <h3>League table tie-break priority</h3>
      <p className="muted">
        Rules apply from top to bottom. Complete ties are flagged for an admin decision.
      </p>
      <div className="rule-list">
        {s.tieRules.map((r, i) => (
          <div key={r}>
            <span>{i + 1}</span>
            <strong>{ruleNames[r]}</strong>
            {[-1, 1].map((d) => (
              <button
                type="button"
                className="icon-button"
                key={d}
                aria-label={`Move ${ruleNames[r]} ${d === -1 ? 'up' : 'down'}`}
                disabled={i + d < 0 || i + d >= 5}
                onClick={() => {
                  const order = [...s.tieRules];
                  [order[i], order[i + d]] = [order[i + d], order[i]];
                  setSettings({ ...s, tieRules: order });
                }}
              >
                {d === -1 ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
export function KnockoutDeciderFields({
  settings: s,
  setSettings,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  if (!s.knockout) return null;
  return (
    <>
      <div className="notice">
        Semi-finals and finals must have a winner. A tied score / aggregate must be resolved using
        the method below. League draw rules do not apply.
      </div>
      <label>
        Knockout tied-score / aggregate decider
        <select
          value={s.resolution}
          onChange={(e) =>
            setSettings({ ...s, resolution: e.target.value as Settings['resolution'] })
          }
        >
          <option value="either">Penalties or admin-selected winner</option>
          <option value="penalties">Penalty shootout</option>
          <option value="manual">Admin-selected winner</option>
        </select>
      </label>
      <p className="fine-print">
        No away-goals rule. Scores include any extra time; penalty scores are recorded separately. A
        two-leg tie is decided on aggregate after both legs.
      </p>
    </>
  );
}
export const knockoutFormats = [
  {
    size: 0,
    title: 'League only',
    description: 'First place wins after the final league table is confirmed.',
  },
  { size: 2, title: 'Top 2 → Final', description: 'League positions 1 and 2 play for the title.' },
  {
    size: 4,
    title: 'Top 4 → Semi-finals → Final',
    description: '1st vs 4th and 2nd vs 3rd. The winners meet in the final.',
  },
  {
    size: 8,
    title: 'Top 8 → Quarter-finals → Semi-finals → Final',
    description:
      '1st vs 8th, 4th vs 5th, 2nd vs 7th, 3rd vs 6th. Winners advance in bracket order.',
  },
];
export function KnockoutOptions({
  value,
  playerCount,
  onChange,
}: {
  value: number;
  playerCount: number;
  onChange: (size: number) => void;
}) {
  return (
    <div className="option-grid knockout-options" role="group" aria-label="Knockout format">
      {knockoutFormats.map(({ size, title, description }) => (
        <button
          key={size}
          type="button"
          aria-label={title}
          aria-pressed={value === size}
          aria-describedby={`knockout-description-${size}`}
          disabled={size > playerCount}
          className={'option ' + (value === size ? 'selected' : '')}
          onClick={() => onChange(size)}
        >
          <strong>{title}</strong>
          <small id={`knockout-description-${size}`}>
            {description}
            {size > playerCount && ` Add at least ${size} players to enable this format.`}
          </small>
        </button>
      ))}
    </div>
  );
}
export default function Wizard({ onAuth, signedIn }: { onAuth: () => void; signedIn: boolean }) {
  const [step, setStep] = useState(0),
    [countText, setCountText] = useState('4'),
    [s, setS] = useState<Settings>({ ...defaultSettings }),
    [players, setPlayers] = useState<Player[]>(() =>
      Array.from({ length: 4 }, (_, i) => ({
        id: crypto.randomUUID(),
        name: '',
        avatar: emojis[i],
      })),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const steps = ['Players', 'Format', 'League', 'Knockout', 'Review'];
  const updatePlayers = (p: Player[]) => {
    for (const removed of players.filter((old) => !p.some((next) => next.id === old.id)))
      void discardLogo(removed.avatar);
    setCountText(String(p.length));
    setPlayers(p);
    if (s.knockout > p.length) setS({ ...s, knockout: 0 });
  };
  const countValid = /^\d+$/.test(countText) && Number(countText) >= 2 && Number(countText) <= 32;
  const validate = () => {
    if (!countValid) {
      setError('Enter a whole number of players from 2 to 32.');
      return false;
    }
    const result = setupSchema.safeParse({ settings: s, players });
    if (!result.success) {
      setError(result.error.issues.map((i) => i.message).join(' '));
      return false;
    }
    setError('');
    return true;
  };
  return (
    <div className="wizard-page">
      <header className="site-header">
        <Brand />
        <a className="text-button" href="/">
          Exit setup
        </a>
      </header>
      <main className="wizard">
        <span className="eyebrow">BUILD YOUR COMPETITION</span>
        <h1>
          Every great rivalry
          <br />
          starts here<span className="lime">.</span>
        </h1>
        <div className="wizard-progress">
          {steps.map((label, i) => (
            <div key={label} className={i === step ? 'active' : i < step ? 'done' : ''}>
              <span>{i < step ? <Check size={15} /> : i + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <div className="panel wizard-panel">
          <div className="section-title">
            <h2>
              {
                [
                  'Meet the contenders',
                  'Choose your format',
                  'League / normal match rules',
                  'Knockout rules',
                  'Ready for kickoff?',
                ][step]
              }
            </h2>
            <span className="muted">0{step + 1} / 05</span>
          </div>
          {step === 0 && (
            <>
              <label>
                Tournament name
                <input
                  placeholder="e.g. Sunday Night Cup"
                  value={s.name}
                  maxLength={70}
                  onChange={(e) => setS({ ...s, name: e.target.value })}
                />
              </label>
              <div className="section-title">
                <h3>Your players</h3>
                <span className="pill">{players.length} / 32</span>
              </div>
              <label>
                Number of players
                <input
                  type="number"
                  min={2}
                  max={32}
                  value={countText}
                  onChange={(e) => {
                    setCountText(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 2 && n <= 32)
                      updatePlayers(
                        Array.from(
                          { length: n },
                          (_, i) =>
                            players[i] ?? {
                              id: crypto.randomUUID(),
                              name: '',
                              avatar: emojis[i % emojis.length],
                            },
                        ),
                      );
                  }}
                />
              </label>
              {!countValid && <ErrorText message="Enter a whole number of players from 2 to 32." />}
              <PlayerFields players={players} onChange={updatePlayers} />
            </>
          )}
          {step === 1 && (
            <>
              <p className="muted">Everyone plays everyone. Choose how many times they face off.</p>
              <div className="option-grid">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    className={'option ' + (s.repetitions === n ? 'selected' : '')}
                    onClick={() => setS({ ...s, repetitions: n })}
                  >
                    <span className="option-check">
                      {s.repetitions === n && <Check size={14} />}
                    </span>
                    <strong>
                      {n === 1
                        ? 'Single round robin'
                        : n === 2
                          ? 'Double round robin'
                          : `${n} matches per opponent`}
                    </strong>
                    <small>
                      {((players.length * (players.length - 1)) / 2) * n} total league matches
                    </small>
                  </button>
                ))}
              </div>
              <div className="notice">
                Fixtures are generated automatically with balanced matchdays. Odd player counts get
                a rest round.
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <p className="muted">Finish with a knockout showdown, or crown the league leader.</p>
              <KnockoutOptions
                value={s.knockout}
                playerCount={players.length}
                onChange={(knockout) => setS({ ...s, knockout })}
              />
              {s.knockout > 0 && (
                <>
                  <label>
                    Matches per knockout tie
                    <select
                      value={s.legs}
                      onChange={(e) => setS({ ...s, legs: Number(e.target.value) })}
                    >
                      <option value={1}>Single leg</option>
                      <option value={2}>Two legs, including the final</option>
                    </select>
                  </label>
                  <KnockoutDeciderFields settings={s} setSettings={setS} />
                </>
              )}
            </>
          )}
          {step === 2 && <RulesFields settings={s} setSettings={setS} />}
          {step === 4 && (
            <>
              <div className="review-title">
                <Trophy />
                <h2>{s.name}</h2>
              </div>
              <dl className="review-list">
                <div>
                  <dt>Players</dt>
                  <dd>{players.length} contenders</dd>
                </div>
                <div>
                  <dt>League</dt>
                  <dd>
                    {s.repetitions} match{s.repetitions > 1 ? 'es' : ''} per opponent ·{' '}
                    {((players.length * (players.length - 1)) / 2) * s.repetitions} fixtures
                  </dd>
                </div>
                <div>
                  <dt>League points</dt>
                  <dd>
                    Win {s.win} · Draw {s.draw} · Loss {s.loss}
                  </dd>
                </div>
                <div>
                  <dt>League draws</dt>
                  <dd>
                    {s.leagueDrawsAllowed === false ? 'Penalty shootout required' : 'Draws allowed'}
                  </dd>
                </div>
                {s.leagueDrawsAllowed === false && (
                  <div>
                    <dt>League penalty points</dt>
                    <dd>
                      {s.leaguePenaltyPoints
                        ? `Winner ${s.leaguePenaltyPoints.winner} · Loser ${s.leaguePenaltyPoints.loser}`
                        : 'Not configured — tied results cannot be finalized yet'}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Knockout</dt>
                  <dd>
                    {s.knockout
                      ? `Top ${s.knockout} · ${s.legs === 2 ? 'Two legs' : 'Single leg'}`
                      : 'League champion'}
                  </dd>
                </div>
                <div>
                  <dt>Tie breaks</dt>
                  <dd>{s.tieRules.map((r) => ruleNames[r]).join(' → ')}</dd>
                </div>
                {s.knockout > 0 && (
                  <div>
                    <dt>Knockout decider (all rounds)</dt>
                    <dd>
                      {s.resolution === 'either'
                        ? 'Penalties or admin-selected winner'
                        : s.resolution === 'manual'
                          ? 'Admin-selected winner'
                          : 'Penalty shootout'}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="player-chips">
                {players.map((p) => (
                  <span key={p.id}>
                    <TeamLogo value={p.avatar} /> {p.name}
                  </span>
                ))}
              </div>
              <div className="notice">
                You’ll get a public link for everyone to follow. Review your setup, then generate
                fixtures when you’re ready.
              </div>
              {!signedIn && (
                <button className="button secondary full" onClick={onAuth}>
                  Sign in to create your tournament
                </button>
              )}
            </>
          )}
          <ErrorText message={error} />
          <div className="wizard-buttons">
            <button
              className="button secondary"
              disabled={step === 0 || busy}
              onClick={() => {
                setStep(step - 1);
                setError('');
              }}
            >
              <ArrowLeft size={17} />
              Back
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                if (!validate()) return;
                if (step < 4) {
                  setStep(step + 1);
                  return;
                }
                if (!signedIn || !auth) {
                  onAuth();
                  return;
                }
                setBusy(true);
                try {
                  const result = await create(s, players);
                  location.assign('/t/' + result.tournament.code + '/admin');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Unable to create tournament.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Creating tournament…' : step === 4 ? 'Create tournament' : 'Continue'}
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
        <p className="fine-print center">
          <ShieldNote /> Shared with your players. Managed only by you.
        </p>
      </main>
    </div>
  );
}
function ShieldNote() {
  return <span>✓</span>;
}
