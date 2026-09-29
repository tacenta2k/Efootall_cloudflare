import TeamLogo from './TeamLogo';
import { copyText } from '../lib/clipboard';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Trophy,
  LayoutDashboard,
  ListOrdered,
  CalendarDays,
  ChartNoAxesCombined,
  GitBranch,
  Users,
  Settings,
  Share2,
  Copy,
  ArrowRight,
  Radio,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  ApiError,
  TournamentConflictError,
  change,
  getTournament,
  type Snapshot,
} from '../lib/api';
import { aggregate, standings, played } from '../lib/engine';
import type { Action, Match } from '../lib/types';
import { Brand, Empty, ErrorText, SectionTitle, statusLabel, TournamentStatus } from './ui';
import { MatchCard, Matches, ScoreModal } from './Matches';
import { Profile, Statistics, Table, Form } from './Standings';
import TournamentInfo from './TournamentInfo';
const Admin = lazy(() => import('./Admin'));
const Knockout = lazy(() => import('./Knockout'));
const tabs = [
  ['home', 'Overview', LayoutDashboard],
  ['table', 'Standings', ListOrdered],
  ['matches', 'Matches', CalendarDays],
  ['stats', 'Statistics', ChartNoAxesCombined],
  ['knockout', 'Knockout', GitBranch],
  ['players', 'Players', Users],
  ['admin', 'Admin', Settings],
] as const;
export default function Dashboard({
  code,
  onAuth,
  authRevision,
}: {
  code: string;
  onAuth: () => void;
  authRevision: number;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState(location.pathname.endsWith('/admin') ? 'admin' : 'home'),
    [match, setMatch] = useState<Match | null>(null),
    [profile, setProfile] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [refreshing, setRefreshing] = useState(false),
    [lastSync, setLastSync] = useState<Date | null>(null);
  const latest = useRef<Snapshot | null>(null),
    inFlight = useRef(false);
  const accept = useCallback((s: Snapshot) => {
    if (!latest.current || s.tournament.version >= latest.current.tournament.version) {
      latest.current = s;
      setSnapshot(s);
    }
    setLastSync(new Date());
  }, []);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const s = await getTournament(code);
      accept(s);
      setError('');
      try {
        const recent = JSON.parse(localStorage.getItem('touchline-recent') ?? '[]') as {
          code: string;
          name: string;
        }[];
        localStorage.setItem(
          'touchline-recent',
          JSON.stringify(
            [
              { code, name: s.tournament.settings.name },
              ...recent.filter((r) => r.code !== code),
            ].slice(0, 5),
          ),
        );
      } catch {
        /* Optional convenience only. */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load tournament.');
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [code, accept]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, authRevision]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function act(action: Action, version?: number) {
    try {
      const result = await change(latest.current!.tournament, action, version);
      accept(result);
      setNotice(
        action.type === 'score'
          ? 'Result saved. Everyone’s standings are updating.'
          : 'Tournament updated.',
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // A poll already in flight may predate the rejected write. Fetch a new
        // snapshot and carry it to the form instead of skipping that refresh.
        try {
          accept(await getTournament(code));
          setError('');
        } catch {
          throw new ApiError(
            409,
            'This tournament changed, but the latest values could not be loaded. Your edits are preserved. Reconnect and retry.',
          );
        }
        throw new TournamentConflictError(latest.current!);
      }
      throw e;
    }
  }
  const share = async (copy = false) => {
    const url = location.origin + '/t/' + code;
    setError('');
    setNotice('');
    try {
      if (!copy && navigator.share)
        await navigator.share({
          title: snapshot?.tournament.settings.name,
          text: 'Follow the tournament on Touchline',
          url,
        });
      else {
        await copyText(url);
        setNotice('Public link copied!');
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        setError('Could not copy automatically. Public link: ' + url);
    }
  };
  if (!snapshot)
    return (
      <div className="dashboard-loading">
        <Brand />
        <div className="panel">
          <Trophy size={40} />
          <h1>{error ? 'Unable to open tournament' : 'Getting the pitch ready…'}</h1>
          <ErrorText message={error} />
          {error && (
            <button className="button primary" onClick={() => void refresh()}>
              Try again
            </button>
          )}
          <a className="text-button" href="/">
            Back to home
          </a>
        </div>
      </div>
    );
  const { tournament: t, canEdit } = snapshot,
    rows = standings(t),
    done = t.matches.filter(played),
    next = t.matches.find((m) => !played(m)),
    champion = t.players.find((p) => p.id === t.champion),
    leader = rows[0];
  const openMatch = (m: Match) => {
    setProfile(null);
    setMatch(m);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-tournament">
          <span className="sidebar-trophy">
            <Trophy size={22} />
          </span>
          <div>
            <strong>{t.settings.name}</strong>
            <small>{code}</small>
          </div>
        </div>
        <span className="eyebrow nav-label">TOURNAMENT</span>
        <nav>
          {tabs.map(([id, title, Icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={19} />
              {title}
              {id === 'admin' && canEdit && <span className="admin-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="live-label">
            <span className="live-dot" />
            {error ? 'Connection interrupted' : 'Shared tournament'}
          </div>
          <p>
            Every score. Every device.
            <br />
            One competition.
          </p>
          <a className="text-button" href="/">
            Back to home
            <ArrowRight size={16} />
          </a>
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-header">
          <div className="mobile-brand">
            <Brand small />
          </div>
          <div className="breadcrumb">
            Your tournament <span>/</span> {tabs.find((x) => x[0] === tab)?.[1]}
          </div>
          <div className="dashboard-header-actions">
            <span className="viewer-badge">
              <ShieldCheck size={14} />
              {canEdit ? 'Administrator' : 'Spectator'}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh tournament"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
            </button>
            <button className="button secondary small" onClick={() => void share()}>
              <Share2 size={16} />
              <span>Share tournament</span>
            </button>
          </div>
        </header>
        <main className="dashboard-main">
          <div className="tournament-heading">
            <div>
              <div className="eyebrow">
                <TournamentStatus status={t.status} />
              </div>
              <h1>
                {t.settings.name}
                <span className="lime">.</span>
              </h1>
              <p>
                {t.players.length} players <span>·</span> {t.settings.repetitions}{' '}
                {t.settings.repetitions === 1 ? 'round' : 'rounds'} per opponent <span>·</span>{' '}
                {t.settings.knockout ? `Top ${t.settings.knockout} qualify` : 'League format'}
              </p>
            </div>
            <button
              className="code-button"
              onClick={() => void share(true)}
              title="Copy public link"
            >
              {code}
              <Copy size={14} />
            </button>
          </div>
          <ErrorText message={error} />
          {notice && (
            <div className="toast" role="status">
              ✓ {notice}
            </div>
          )}
          {champion && (
            <section className="champion-banner">
              <div className="champion-trophy">
                <Trophy size={50} />
              </div>
              <div>
                <span className="eyebrow">THE CHAMPION</span>
                <h2>
                  <TeamLogo value={champion.avatar} /> {champion.name}
                </h2>
                <p>{t.settings.name} · A tournament to remember.</p>
                {t.ties.length > 0 && (
                  <p>
                    Final aggregate:{' '}
                    {(() => {
                      const tie = t.ties.at(-1)!,
                        a = aggregate(t, tie);
                      return `${t.players.find((p) => p.id === tie.a)?.name} ${a.a}–${a.b} ${t.players.find((p) => p.id === tie.b)?.name}`;
                    })()}
                  </p>
                )}
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  const final = t.matches.filter((m) => m.stage === 'knockout').at(-1);
                  if (final) openMatch(final);
                  else setTab('table');
                }}
              >
                View {t.ties.length ? 'final' : 'table'}
                <ArrowRight size={17} />
              </button>
            </section>
          )}
          {t.status === 'league_complete' && (
            <div className="stage-banner">
              <Trophy size={24} />
              <div>
                <strong>League stage complete</strong>
                <p>
                  All results are in.{' '}
                  {canEdit
                    ? 'Review the standings, then confirm the next stage.'
                    : 'Waiting for the administrator to confirm the final table.'}
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() => setTab(canEdit ? 'admin' : 'table')}
              >
                {canEdit ? 'Review & advance' : 'Review table'}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {tab === 'home' && (
            <>
              <div className="overview-cards">
                <div className="panel leader-card">
                  <span className="eyebrow">
                    {champion
                      ? 'THE CHAMPION'
                      : done.some((m) => m.stage === 'league')
                        ? 'CURRENT LEADER'
                        : 'READY TO COMPETE'}
                  </span>
                  <div>
                    <span className="big-avatar">
                      <TeamLogo value={champion?.avatar ?? leader.avatar} />
                    </span>
                    <div>
                      <h2>{champion?.name ?? (leader.played ? leader.name : 'Kickoff awaits')}</h2>
                      <p>
                        {leader.played
                          ? `${leader.points} points${leader.tied ? ' · tied position' : ''}`
                          : `${t.players.length} players. One trophy.`}
                      </p>
                    </div>
                    <Trophy className="leader-trophy" size={34} />
                  </div>
                </div>
                <div className="panel progress-card">
                  <span className="eyebrow">TOURNAMENT PROGRESS</span>
                  <h2>
                    {done.length}
                    <span> / {t.matches.length}</span>
                  </h2>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${t.matches.length ? (done.length / t.matches.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p>{t.matches.length - done.length} generated matches remaining</p>
                </div>
                <div className="panel stage-card">
                  <span className="eyebrow">THE COMPETITION</span>
                  <GitBranch size={26} />
                  <h3>{statusLabel(t.status)}</h3>
                  <p>
                    {t.settings.knockout
                      ? `${t.settings.legs === 2 ? 'Two-leg' : 'Single-leg'} knockout · Top ${t.settings.knockout}`
                      : 'The league leader takes the trophy'}
                  </p>
                </div>
              </div>
              <div className="overview-columns">
                <section>
                  <SectionTitle title="The league table" eyebrow="RACE TO THE TOP">
                    <button className="text-button" onClick={() => setTab('table')}>
                      Full standings
                      <ArrowRight size={16} />
                    </button>
                  </SectionTitle>
                  <Table t={t} onPlayer={setProfile} compact />
                </section>
                <section>
                  <SectionTitle title="Next on the pitch" eyebrow="UP NEXT" />
                  {next ? (
                    <MatchCard t={t} match={next} onOpen={openMatch} />
                  ) : (
                    <div className="panel">
                      <Empty title={t.status === 'setup' ? 'Ready when you are' : 'All caught up'}>
                        {t.status === 'setup'
                          ? 'The admin can generate fixtures from the Admin tab.'
                          : 'No upcoming fixtures in the current stage.'}
                      </Empty>
                    </div>
                  )}
                </section>
              </div>
              <SectionTitle title="The latest action" eyebrow="RECENT RESULTS">
                <button className="text-button" onClick={() => setTab('matches')}>
                  All matches
                  <ArrowRight size={16} />
                </button>
              </SectionTitle>
              {done.length ? (
                <div className="matches-grid">
                  {[...done]
                    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
                    .slice(0, 3)
                    .map((m) => (
                      <MatchCard key={m.id} t={t} match={m} onOpen={openMatch} />
                    ))}
                </div>
              ) : (
                <div className="panel">
                  <Empty title="The story is still unwritten">
                    No results have been recorded. Let the first match do the talking.
                  </Empty>
                </div>
              )}
            </>
          )}
          {tab === 'table' && (
            <>
              <SectionTitle title="League standings" eyebrow="EVERY POINT COUNTS" />
              <Table t={t} onPlayer={setProfile} />
              <p className="fine-print">
                Order: {t.settings.tieRules.join(' → ')}. Complete ties share a rank until resolved
                by the admin. Form follows fixture order.
              </p>
            </>
          )}
          {tab === 'matches' && (
            <>
              <SectionTitle title="Fixtures & results" eyebrow="THE MATCHDAY CENTRE" />
              <Matches t={t} onOpen={openMatch} />
            </>
          )}
          {tab === 'stats' && (
            <>
              <SectionTitle title="Behind the scoreline" eyebrow="TOURNAMENT STATISTICS" />
              <Statistics t={t} onPlayer={setProfile} />
            </>
          )}
          {tab === 'players' && (
            <>
              <SectionTitle title="Meet the contenders" eyebrow="THE LINEUP" />
              <div className="players-grid">
                {rows.map((r) => (
                  <button key={r.id} className="panel player-card" onClick={() => setProfile(r.id)}>
                    <span className="big-avatar">
                      <TeamLogo value={r.avatar} />
                    </span>
                    <h3>{r.name}</h3>
                    <p>
                      {r.points} PTS <span>·</span> {r.gf} GOALS
                    </p>
                    <Form values={r.form} />
                  </button>
                ))}
              </div>
            </>
          )}
          <Suspense fallback={<div className="panel loading">Loading tournament tools…</div>}>
            {tab === 'knockout' && (
              <>
                <SectionTitle title="The road to glory" eyebrow="KNOCKOUT STAGE" />
                <Knockout t={t} admin={canEdit} onMatch={openMatch} onAction={act} />
              </>
            )}
            {tab === 'admin' &&
              (canEdit ? (
                <Admin key={t.status} t={t} onAction={act} onMatches={() => setTab('matches')} />
              ) : (
                <div className="panel">
                  <Empty title="Reserved for the administrator">
                    Only the tournament creator can manage players and enter results.
                  </Empty>
                  <button className="button primary centered" onClick={onAuth}>
                    Sign in as administrator
                  </button>
                </div>
              ))}
          </Suspense>
          <TournamentInfo tournament={t} />
          <div className="dashboard-footer">
            <span>
              <Radio size={13} />
              {error
                ? 'Updates paused'
                : `Synced ${lastSync?.toLocaleTimeString() ?? 'just now'}`}{' '}
              · refreshes every 5 seconds
            </span>
            <span>
              Created{' '}
              {new Date(t.createdAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
        </main>
      </div>
      <nav className="mobile-nav">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            aria-label={label}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {match && (
        <ScoreModal
          key={match.id}
          m={match}
          t={t}
          admin={canEdit}
          onAction={act}
          onClose={() => setMatch(null)}
        />
      )}{' '}
      {profile && t.players.some((p) => p.id === profile) && (
        <Profile id={profile} t={t} onClose={() => setProfile(null)} onMatch={openMatch} />
      )}
    </div>
  );
}
