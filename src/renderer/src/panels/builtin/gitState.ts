import { useEffect, useState } from 'preact/hooks';
import type { GitStatus } from '@shared/types';

const REFRESH_DELAY_MS = 300;

/** The project's Git status, refreshed after Saturn's own Git actions, file changes and when the window regains focus. */
export function useGitStatus(): [GitStatus | null, () => void] {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const load = () => void window.saturn.git.status().then(setStatus, () => setStatus({ repo: false, branch: null, upstream: null, ahead: 0, behind: 0, changes: [], operation: null, conflicts: [] }));
  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, REFRESH_DELAY_MS);
    };
    const offGit = window.saturn.git.onChanged(load);
    const offFs = window.saturn.fs.onChanged(soon);
    window.addEventListener('focus', soon);
    return () => {
      clearTimeout(timer);
      offGit();
      offFs();
      window.removeEventListener('focus', soon);
    };
  }, []);
  return [status, load];
}

/** "3 minutes ago", "2 days ago"… for commit dates. */
export function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, name] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

export function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}
