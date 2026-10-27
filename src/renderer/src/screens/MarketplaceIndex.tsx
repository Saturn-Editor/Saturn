import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { MarketplaceIndex } from '@shared/marketplace';
import type { ModuleSummary } from '@shared/modules';
import type { ThemeSummary } from '@shared/types';
import { Button } from '@renderer/components';

/** Installed languages, kept up to date. */
export function useInstalledModules(): ModuleSummary[] {
  const [installed, setInstalled] = useState<ModuleSummary[]>([]);
  useEffect(() => {
    const load = () => void window.saturn.modules.list().then(setInstalled);
    load();
    return window.saturn.modules.onChanged(load);
  }, []);
  return installed;
}

/** Installed themes, kept up to date. */
export function useInstalledThemes(): ThemeSummary[] {
  const [installed, setInstalled] = useState<ThemeSummary[]>([]);
  useEffect(() => {
    const load = () => void window.saturn.themes.list().then(setInstalled);
    load();
    return window.saturn.themes.onListChanged(load);
  }, []);
  return installed;
}

/** Already installed at the index's version, so there's nothing to install or update. */
export function isUpToDate(installed: { id: string; version: string | null }[], entry: { id: string; version: string }): boolean {
  return installed.some((i) => i.id === entry.id && i.version === entry.version);
}

export type IndexState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; index: MarketplaceIndex };

/** Fetches the marketplace index once `enabled` turns true; returns its state and a retry. */
export function useMarketplaceIndex(enabled = true): [IndexState | null, () => void] {
  const [state, setState] = useState<IndexState | null>(null);
  const load = () => {
    setState({ status: 'loading' });
    void window.saturn.marketplace.index().then((index) => setState({ status: 'loaded', index }), () => setState({ status: 'failed' }));
  };
  useEffect(() => {
    if (enabled && state === null) load();
  }, [enabled]);
  return [state, load];
}

function Centered({ children }: { children: ComponentChildren }) {
  return <div class="h-full min-h-24 flex flex-col items-center justify-center gap-2">{children}</div>;
}

interface MarketplaceEntriesProps<T> {
  state: IndexState | null;
  pick: (index: MarketplaceIndex) => T[];
  /** Entries to leave out, e.g. ones already installed and up to date. */
  hide?: (entry: T) => boolean;
  /** Shown when entries exist but every one is hidden. */
  allHidden?: string;
  onRetry: () => void;
  children: (entries: T[]) => ComponentChildren;
}

/**
 * Loading, failure and empty states around a list of index entries. The index always has entries,
 * so an empty list means something is wrong and is shown as an error. A list that's empty only
 * because everything is hidden (already installed) says so instead.
 */
export function MarketplaceEntries<T>({ state, pick, hide, allHidden, onRetry, children }: MarketplaceEntriesProps<T>) {
  if (state?.status === 'loaded') {
    const entries = pick(state.index);
    const shown = hide ? entries.filter((e) => !hide(e)) : entries;
    if (shown.length > 0) return <>{children(shown)}</>;
    if (entries.length > 0) return <Centered><div class="text-muted">{allHidden}</div></Centered>;
  }
  if (state === null || state.status === 'loading') return <Centered><div class="text-muted">Loading...</div></Centered>;
  return (
    <Centered>
      <div class="text-strong">{state.status === 'failed' ? 'Unable to connect to Marketplace' : 'Sorry, something went wrong.'}</div>
      <Button testId="marketplace-retry" onClick={onRetry}>Retry</Button>
    </Centered>
  );
}
