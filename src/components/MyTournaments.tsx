import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Trophy, Trash2 } from 'lucide-react';
import { deleteTournament, getMyTournaments, type OwnedTournament } from '../lib/api';
import { Brand, ErrorText, Modal, TournamentStatus } from './ui';
import { handleInternalLink } from '../lib/navigation';
export default function MyTournaments({ onAuth }: { onAuth: () => void }) {
  const [items, setItems] = useState<OwnedTournament[] | null>(null);
  const [selected, setSelected] = useState<OwnedTournament | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const createLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (notice && !selected) createLink.current?.focus();
  }, [notice, selected]);
  async function remove() {
    if (!selected || confirmation !== 'DELETE' || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setDeleteError('');
    try {
      await deleteTournament(selected.code, confirmation);
      setItems((current) => current?.filter((t) => t.code !== selected.code) ?? null);
      setNotice(`${selected.name} was deleted.`);
      setSelected(null);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : 'Unable to delete the tournament. Please retry.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    getMyTournaments()
      .then(({ tournaments }) => {
        if (active) setItems(tournaments);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  return (
    <div className="home">
      <header className="site-header">
        <Brand />
        <button className="text-button" onClick={onAuth}>
          Your account
        </button>
      </header>
      <main className="home-tournaments">
        <div className="owned-tournaments-heading">
          <span className="eyebrow">YOUR COMPETITIONS</span>
          <h1>My Tournaments</h1>
          <p>Pick up where you left off.</p>
        </div>
        {notice && <p role="status">{notice}</p>}
        <ErrorText message={error} />
        {error ? (
          <button className="button secondary" onClick={() => setRetry((r) => r + 1)}>
            Retry loading tournaments
          </button>
        ) : items === null ? (
          <p role="status">Loading your tournaments…</p>
        ) : (
          <div
            className={items.length ? 'owned-tournaments-content' : 'owned-tournaments-empty panel'}
          >
            {items.length === 0 && (
              <>
                <Trophy size={28} aria-hidden="true" />
                <h2>Your next competition starts here</h2>
                <p>Create your first tournament to get started.</p>
              </>
            )}
            <div className="owned-tournaments-list">
              {items.map((t) => (
                <div key={t.code} className="owned-tournament-card">
                  <a href={'/t/' + t.code} onClick={handleInternalLink}>
                    <div className="owned-tournament-details">
                      <div className="owned-tournament-title">
                        <h2>{t.name}</h2>
                        {t.status && <TournamentStatus status={t.status} />}
                      </div>
                      <div className="owned-tournament-meta">
                        <span>{t.players} players</span>
                        <span>{t.knockout ? 'League + knockout' : 'League only'}</span>
                        {t.knockout > 0 && <span>Top {t.knockout} qualify</span>}
                      </div>
                    </div>
                    <span className="button primary owned-tournament-continue">
                      Continue <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </a>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${t.name}`}
                    title="Delete tournament"
                    onClick={() => {
                      setSelected(t);
                      setConfirmation('');
                      setDeleteError('');
                      setNotice('');
                    }}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <a
              ref={createLink}
              className="button primary"
              href="/create"
              onClick={handleInternalLink}
            >
              {items.length ? '+ Create new tournament' : 'Create Tournament'}
            </a>
          </div>
        )}
      </main>
      {selected && (
        <Modal
          title="Delete tournament?"
          onClose={() => {
            if (!submitting.current) setSelected(null);
          }}
        >
          <p>
            Permanently delete <strong>{selected.name}</strong>? The tournament, teams, players,
            matches, results, settings, and all related tournament data will be permanently deleted.
            This cannot be undone.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <label>
              Type DELETE to confirm
              <input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <ErrorText message={deleteError} />
            <div className="tournament-delete-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button danger"
                disabled={busy || confirmation !== 'DELETE'}
              >
                {busy ? 'Deleting…' : 'Delete Tournament'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
