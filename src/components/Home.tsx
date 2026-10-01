import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Radio,
  ShieldCheck,
  GitBranch,
  Plus,
  Trophy,
  Users,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { Brand, Modal, ErrorText } from './ui';
import { getTournament } from '../lib/api';
import { handleInternalLink, navigate } from '../lib/navigation';
import { captureNavigationAuth, makeSnapshotHandoff } from '../lib/navigationSnapshot';
export default function Home({
  onCreate,
  onAuth,
  signedIn,
}: {
  onCreate: () => void;
  onAuth: () => void;
  signedIn: boolean;
}) {
  const [join, setJoin] = useState(false),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  let recent: { code: string; name: string }[] = [];
  try {
    recent = JSON.parse(localStorage.getItem('touchline-recent') ?? '[]');
  } catch {
    /* Convenience history is optional. */
  }
  return (
    <div className="home">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="#how-it-works" className="desktop-link">
            How it works
          </a>
          <span className="header-divider" />
          <button className="text-button" onClick={onAuth}>
            {signedIn ? 'Your account' : 'Admin sign in'}
            <ArrowUpRight size={16} />
          </button>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow hero-eyebrow">
              <span className="live-dot" /> MADE FOR MATCHDAY
            </div>
            <h1>
              Big rivalries.
              <br />
              Real champions.
              <br />
              <span>Your tournament.</span>
            </h1>
            <p>
              From the first kickoff to the final whistle.
              <br className="desktop-link" /> Run your eFootball competition, all in one place.
            </p>
            <div className="hero-actions">
              <button className="button primary" onClick={onCreate}>
                Create tournament
                <Plus size={19} />
              </button>
              <button className="button secondary" onClick={() => setJoin(true)}>
                Join a tournament
                <ArrowUpRight size={18} />
              </button>
            </div>
            <div className="hero-note">
              <span className="mini-avatars">
                ⚽<span>🎮</span>
                <span>🏆</span>
              </span>
              <span>A little competition. A lot of bragging rights.</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Stylized football stadium illustration">
            <div className="art-top">
              <span>
                <span className="live-dot" /> THE STAGE IS YOURS
              </span>
              <span>EST. 2026</span>
            </div>
            <div className="pitch">
              <div className="pitch-half" />
              <div className="pitch-circle" />
              <div className="penalty-box box-top" />
              <div className="penalty-box box-bottom" />
              <div className="pitch-dot" />
            </div>
            <div className="orbital orbit-one" />
            <div className="orbital orbit-two" />
            <div className="football">
              <svg viewBox="0 0 240 240" role="img" aria-label="Football">
                <defs>
                  <radialGradient id="ball">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset=".65" stopColor="#d8dfd4" />
                    <stop offset="1" stopColor="#6c7a63" />
                  </radialGradient>
                  <clipPath id="ballClip">
                    <circle cx="120" cy="120" r="108" />
                  </clipPath>
                </defs>
                <circle cx="120" cy="120" r="108" fill="url(#ball)" />
                <g clipPath="url(#ballClip)" fill="#202a20" stroke="#707c6a" strokeWidth="1.5">
                  <path d="m105 71 46 13 11 47-39 28-41-29z" />
                  <path d="m78 16 14 28-25 34-44-3-11-34z" />
                  <path d="m203 36-28 28 12 44 43 9 16-43z" />
                  <path d="m21 127 32 8 14 45-24 30-34-35z" />
                  <path d="m115 207 4-25 47-23 31 24-8 41-52 17z" />
                </g>
                <g fill="none" stroke="#899581" strokeWidth="2" clipPath="url(#ballClip)">
                  <path d="m92 44 13 27m46 13 24-20m12 44-25 23m-39 28-4 23m-37-52-29 5M23 75l-2 52m46-49 15 52m10-86 83 20m12 44 10 75m-31-24-4-28m-95 49 52 2m-76 28 72-3" />
                </g>
              </svg>
            </div>
            <div className="art-sticker">
              <Trophy size={18} />
              <div>
                ONE TOURNAMENT.<strong>ENDLESS POSSIBILITIES.</strong>
              </div>
            </div>
            <div className="art-bottom">
              <span>PLAY. COMPETE. CONQUER.</span>
              <span className="coordinate">
                01 / ∞ <ArrowUpRight size={17} />
              </span>
            </div>
          </div>
        </section>
        <div className="feature-strip">
          <span>
            <Radio size={17} />
            Live shared standings
          </span>
          <span>
            <GitBranch size={17} />
            Automatic fixtures
          </span>
          <span>
            <ShieldCheck size={17} />
            You control the game
          </span>
          <span>
            <Zap size={17} />
            Built for your phone
          </span>
        </div>
        <section className="home-tournaments">
          <div className="section-title">
            <div>
              <span className="eyebrow">YOUR MATCHDAY HQ</span>
              <h2>
                Let the games begin<span className="lime">.</span>
              </h2>
            </div>
            <span className="subtle-label">LESS ORGANIZING. MORE PLAYING.</span>
          </div>
          <div className="action-grid">
            <button className="action-card create-card" onClick={onCreate}>
              <span className="card-icon">
                <Trophy size={24} />
              </span>
              <span className="card-number">01</span>
              <h3>Build your competition</h3>
              <p>
                Your friends. Your format. Your rules.
                <br />
                Set up a tournament in a few simple steps.
              </p>
              <span className="card-link">
                Create tournament <ArrowRight size={19} />
              </span>
            </button>
            <button className="action-card" onClick={() => setJoin(true)}>
              <span className="card-icon">
                <Users size={24} />
              </span>
              <span className="card-number">02</span>
              <h3>Follow every moment</h3>
              <p>
                Got a tournament code? Step inside.
                <br />
                Fixtures, results and the race to the top.
              </p>
              <span className="card-link">
                Join / view tournament <ArrowRight size={19} />
              </span>
            </button>
            <div className="format-card">
              <div className="mini-bracket">
                <span />
                <span />
                <i />
                <b>
                  <Trophy size={25} />
                </b>
              </div>
              <span className="eyebrow">FROM KICKOFF TO GLORY</span>
              <h3>
                One league.
                <br />
                Your way to the top.
              </h3>
              <p>
                Round robins. Knockout drama.
                <br />A champion to remember.
              </p>
            </div>
          </div>
        </section>
        {recent.length > 0 && (
          <section className="recent-section">
            <h2>Recently opened</h2>
            <div className="recent-list">
              {recent.map((t) => (
                <a key={t.code} href={'/t/' + t.code} onClick={handleInternalLink}>
                  <Trophy size={20} />
                  <div>
                    <strong>{t.name}</strong>
                    <small>{t.code}</small>
                  </div>
                  <ChevronRight size={18} />
                </a>
              ))}
            </div>
          </section>
        )}
        <section id="how-it-works" className="how-section">
          <div>
            <span className="eyebrow">SIMPLE SETUP. SERIOUS COMPETITION.</span>
            <h2>
              Ready in minutes.
              <br />
              Remembered for seasons.
            </h2>
          </div>
          <div className="steps">
            <div>
              <span>01</span>
              <h3>Set the stage</h3>
              <p>Add your players and choose how you compete.</p>
            </div>
            <div>
              <span>02</span>
              <h3>Share the action</h3>
              <p>One link. Everyone follows from their own phone.</p>
            </div>
            <div>
              <span>03</span>
              <h3>Crown your champion</h3>
              <p>Enter scores. We’ll take care of the numbers.</p>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <Brand small />
        <span>For the love of the game.</span>
        <small>Independent community tool. Not affiliated with Konami.</small>
      </footer>
      {join && (
        <Modal title="Find your tournament" onClose={() => setJoin(false)}>
          <p className="muted">Enter the code your tournament admin shared with you.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const generation = captureNavigationAuth();
              try {
                const data = await getTournament(code.trim().toUpperCase());
                navigate('/t/' + data.tournament.code, makeSnapshotHandoff(data, generation));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Tournament not found.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Tournament code
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="EFC-XXXXXXXX"
                maxLength={12}
                required
                pattern="EFC-[A-Z2-9]{8}"
                autoCapitalize="characters"
              />
            </label>
            <ErrorText message={error} />
            <button className="button primary full" disabled={busy}>
              {busy ? 'Finding tournament…' : 'View tournament'}
              <ArrowRight size={18} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
