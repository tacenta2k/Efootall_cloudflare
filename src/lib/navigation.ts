import type { MouseEvent } from 'react';
import type { SnapshotHandoff } from './navigationSnapshot';

const positionKey = 'touchline:position';
const guards = new Set<() => boolean>();
let current: { position: number; url: string; state: unknown } | undefined;
let restoring = false;

function initialize() {
  if (current) return;
  const position = Number.isInteger(history.state?.[positionKey]) ? history.state[positionKey] : 0;
  history.replaceState({ ...history.state, [positionKey]: position }, '', location.href);
  current = { position, url: location.href, state: history.state };
}

export function registerNavigationGuard(guard: () => boolean) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

function canLeave() {
  return [...guards].every((guard) => guard());
}

function notify(snapshot?: SnapshotHandoff) {
  window.dispatchEvent(new CustomEvent('touchline:navigate', { detail: { snapshot } }));
}

export function subscribeNavigation(listener: (snapshot?: SnapshotHandoff) => void) {
  initialize();
  const onNavigate = (event: Event) =>
    listener((event as CustomEvent<{ snapshot?: SnapshotHandoff }>).detail.snapshot);
  const onPopState = () => {
    const previous = current!;
    if (restoring) {
      restoring = false;
      return;
    }
    const position = history.state?.[positionKey];
    if (!canLeave()) {
      // Undo traversal without changing the history entries or dirty React form.
      if (Number.isInteger(position) && position !== previous.position) {
        restoring = true;
        history.go(previous.position - position);
      } else {
        history.replaceState(previous.state, '', previous.url);
      }
      return;
    }
    const nextPosition = Number.isInteger(position) ? position : previous.position + 1;
    history.replaceState({ ...history.state, [positionKey]: nextPosition }, '', location.href);
    current = { position: nextPosition, url: location.href, state: history.state };
    notify();
  };
  window.addEventListener('popstate', onPopState);
  window.addEventListener('touchline:navigate', onNavigate);
  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('touchline:navigate', onNavigate);
  };
}

export function navigate(path: string, snapshot?: SnapshotHandoff) {
  initialize();
  const url = new URL(path, location.href);
  if (url.origin !== location.origin) {
    location.assign(url.href);
    return;
  }
  if (restoring || url.href === location.href || !canLeave()) return;
  const position = current!.position + 1;
  history.pushState({ [positionKey]: position }, '', url.href);
  current = { position, url: location.href, state: history.state };
  notify(snapshot);
}

export function handleInternalLink(event: MouseEvent<HTMLAnchorElement>) {
  const anchor = event.currentTarget;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.hasAttribute('download') ||
    (anchor.target && anchor.target !== '_self') ||
    anchor.rel.split(/\s+/).includes('external')
  )
    return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
  event.preventDefault();
  navigate(url.href);
}
