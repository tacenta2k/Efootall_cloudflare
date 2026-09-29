import { useEffect, useRef, type ReactNode } from 'react';
import type { Status } from '../lib/types';
import { X, ArrowUpRight, Trophy } from 'lucide-react';
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <a className="brand" href="/" aria-label="Touchline home">
      <img src="/icon.svg" alt="" />
      <span>
        touchline<span className="brand-dot">.</span>
        {!small && <small>E-FOOTBALL TOURNAMENT MANAGER</small>}
      </span>
    </a>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Trophy size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function Arrow() {
  return <ArrowUpRight size={18} />;
}
export function ErrorText({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
export const statusLabel = (status: string) => status.replaceAll('_', ' ');

/** The persisted server stage is authoritative; this is only its public label. */
export function TournamentStatus({ status }: { status: Status }) {
  const completed = status === 'completed';
  return (
    <span className="tournament-status" aria-label="Tournament status">
      {!completed && <span className="live-dot" aria-hidden="true" />}
      {completed ? 'COMPLETED' : 'LIVE'}
    </span>
  );
}
