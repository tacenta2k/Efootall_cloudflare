import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { auth } from './lib/api';
import { oauthCallbackError, wasAuthCallback } from './lib/auth';
import MyTournaments from './components/MyTournaments';
import Home from './components/Home';
import Auth from './components/Auth';
import { Modal } from './components/ui';
import { handleInternalLink, navigate, subscribeNavigation } from './lib/navigation';
import { invalidateNavigationSnapshots, type SnapshotHandoff } from './lib/navigationSnapshot';
const Wizard = lazy(() => import('./components/Wizard'));
const Dashboard = lazy(() => import('./components/Dashboard'));
export default function App() {
  const [pathname, setPathname] = useState(() => location.pathname);
  const [initialCallback, setInitialCallback] = useState(wasAuthCallback);
  const [pendingSnapshot, setPendingSnapshot] = useState<SnapshotHandoff | undefined>();
  const [showAuth, setShowAuth] = useState(false),
    [signedIn, setSignedIn] = useState(false),
    [authReady, setAuthReady] = useState(!auth),
    [authError, setAuthError] = useState(''),
    [userId, setUserId] = useState(''),
    [authRevision, setAuthRevision] = useState(0),
    [offline, setOffline] = useState(!navigator.onLine),
    [intro, setIntro] = useState(() => {
      try {
        return (
          location.pathname === '/' &&
          !sessionStorage.getItem('touchline-intro') &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches
        );
      } catch {
        return false;
      }
    });
  const lastAuth = useRef({ userId: '', token: '' });
  useEffect(() => {
    return subscribeNavigation((snapshot) => {
      setInitialCallback(false);
      setPathname(location.pathname);
      setPendingSnapshot(snapshot);
    });
  }, []);
  useEffect(() => {
    let active = true;
    let eventReceived = false;
    const sub = auth?.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      eventReceived = true;
      setAuthReady(true);
      setUserId(session?.user.id ?? '');
      setSignedIn(Boolean(session));
      const next = { userId: session?.user.id ?? '', token: session?.access_token ?? '' };
      if (
        next.userId !== lastAuth.current.userId ||
        next.token !== lastAuth.current.token ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED'
      ) {
        lastAuth.current = next;
        invalidateNavigationSnapshots();
        setAuthRevision((r) => r + 1);
      }
      if (session) {
        setShowAuth(false);
        setAuthError('');
      }
    });
    void auth?.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAuthError('Unable to restore your session. Please retry sign-in.');
        if (!eventReceived) {
          setSignedIn(Boolean(data.session));
          setUserId(data.session?.user.id ?? '');
          const next = {
            userId: data.session?.user.id ?? '',
            token: data.session?.access_token ?? '',
          };
          if (next.userId !== lastAuth.current.userId || next.token !== lastAuth.current.token) {
            lastAuth.current = next;
            invalidateNavigationSnapshots();
            setAuthRevision((r) => r + 1);
          }
        }
        setAuthReady(true);
      })
      .catch(() => {
        if (active) {
          setAuthError('Unable to restore your session. Please reload to retry.');
          setAuthReady(true);
        }
      });
    return () => {
      active = false;
      sub?.data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const fn = () => setOffline(!navigator.onLine);
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    return () => {
      window.removeEventListener('online', fn);
      window.removeEventListener('offline', fn);
    };
  }, []);
  const dismissIntro = () => {
    setIntro(false);
    try {
      sessionStorage.setItem('touchline-intro', '1');
    } catch {
      /* Optional. */
    }
  };
  useEffect(() => {
    if (intro) {
      const timeout = setTimeout(dismissIntro, 1400);
      return () => clearTimeout(timeout);
    }
  }, [intro]);
  const match = pathname.match(/^\/t\/([^/]+)(?:\/admin)?\/?$/);
  return (
    <>
      {offline && (
        <div className="offline-banner" role="status">
          <WifiOff size={17} />
          You’re offline. Reconnect to see updates or save results.
        </div>
      )}
      {oauthCallbackError && (
        <div className="notice" role="alert">
          {oauthCallbackError}
        </div>
      )}
      <Suspense fallback={<div className="page-loading">Getting the pitch ready…</div>}>
        {!authReady && !match ? (
          <div className="page-loading" role="status">
            Restoring your session…
          </div>
        ) : authError && !match ? (
          <div className="page-loading" role="alert">
            {authError}
            <button className="button secondary" onClick={() => location.reload()}>
              Retry
            </button>
          </div>
        ) : pathname === '/create' && !initialCallback ? (
          <Wizard onAuth={() => setShowAuth(true)} signedIn={signedIn} onNavigate={navigate} />
        ) : match ? (
          <Dashboard
            key={pathname}
            code={decodeURIComponent(match[1]).toUpperCase()}
            onAuth={() => setShowAuth(true)}
            authRevision={authRevision}
            authIdentity={userId}
            initialSnapshot={pendingSnapshot}
          />
        ) : pathname === '/' || pathname === '/auth/callback' || initialCallback ? (
          signedIn ? (
            <MyTournaments key={userId} onAuth={() => setShowAuth(true)} />
          ) : (
            <Home
              onCreate={() => setShowAuth(true)}
              onAuth={() => setShowAuth(true)}
              signedIn={signedIn}
            />
          )
        ) : (
          <div className="page-loading">
            <h1>Page not found</h1>
            <a href="/" onClick={handleInternalLink}>
              Back to Touchline
            </a>
          </div>
        )}
      </Suspense>
      {showAuth &&
        (signedIn ? (
          <Modal title="You’re signed in" onClose={() => setShowAuth(false)}>
            <p>You can create tournaments and manage the competitions you own.</p>
            <button
              className="button secondary"
              onClick={async () => {
                await auth?.auth.signOut();
                setShowAuth(false);
              }}
            >
              Sign out
            </button>
          </Modal>
        ) : (
          <Auth onClose={() => setShowAuth(false)} />
        ))}
      {intro && (
        <div className="intro">
          <img src="/icon.svg" alt="" />
          <strong>
            touchline<span>.</span>
          </strong>
          <span>E-FOOTBALL TOURNAMENT MANAGER</span>
          <button onClick={dismissIntro}>Skip intro →</button>
        </div>
      )}
    </>
  );
}
