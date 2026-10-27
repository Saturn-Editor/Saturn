import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { chooseVersion, compareVersions, type MarketplaceEntry, type MarketplaceKind } from '@shared/marketplace';
import type { ModuleKind, ModuleSummary } from '@shared/modules';
import type { ThemeSummary } from '@shared/types';
import { Button } from '@renderer/components';

/** Installed languages or extensions, kept up to date. */
export function useInstalledModules(kind: ModuleKind = 'language'): ModuleSummary[] {
  const [installed, setInstalled] = useState<ModuleSummary[]>([]);
  useEffect(() => {
    const api = kind === 'language' ? window.saturn.languages : window.saturn.extensions;
    const load = () => void api.list().then(setInstalled);
    load();
    return window.saturn.modules.onChanged(load);
  }, [kind]);
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

/**
 * Installed, and no newer version this Saturn can install exists (a newer one needing a newer Saturn
 * doesn't count). Such entries live under Installed rather than Available.
 */
export function isUpToDate(installed: { id: string; version: string | null }[], entry: MarketplaceEntry): boolean {
  const mine = installed.find((i) => i.id === entry.id);
  if (!mine?.version) return !!mine && !chooseVersion(entry).installable;
  const best = chooseVersion(entry).installable;
  return !best || compareVersions(mine.version, best.version) >= 0;
}

/** What an installed item can do: update to a version this Saturn supports, or only see one that needs a newer Saturn. */
export function updateFor(entry: MarketplaceEntry | undefined, version: string | null): { canUpdateTo: string | null; needsNewerSaturn: string | null } {
  if (!entry || !version) return { canUpdateTo: null, needsNewerSaturn: null };
  const { installable, latest } = chooseVersion(entry);
  const canUpdateTo = installable && compareVersions(installable.version, version) > 0 ? installable.version : null;
  const needsNewerSaturn = compareVersions(latest.version, canUpdateTo ?? version) > 0 && latest !== installable ? latest.version : null;
  return { canUpdateTo, needsNewerSaturn };
}

export type ListState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; entries: MarketplaceEntry[] };

/** Fetches one kind's marketplace list once `enabled` turns true; returns its state and a refresh. */
export function useMarketplaceList(kind: MarketplaceKind, enabled = true): [ListState | null, () => void] {
  const [state, setState] = useState<ListState | null>(null);
  const load = () => {
    setState({ status: 'loading' });
    void window.saturn.marketplace.list(kind).then((entries) => setState({ status: 'loaded', entries }), () => setState({ status: 'failed' }));
  };
  useEffect(() => {
    setState(null);
    if (enabled) load();
  }, [kind, enabled]);
  return [state, load];
}

function Centered({ children }: { children: ComponentChildren }) {
  return <div class="h-full min-h-24 flex flex-col items-center justify-center gap-2">{children}</div>;
}

interface MarketplaceEntriesProps {
  state: ListState | null;
  /** Entries to leave out, e.g. ones already installed and up to date. */
  hide?: (entry: MarketplaceEntry) => boolean;
  /** Narrows the list further, e.g. to languages this Saturn can install. */
  filter?: (entry: MarketplaceEntry) => boolean;
  /** Shown when entries exist but every one is hidden. */
  allHidden?: string;
  onRetry: () => void;
  children: (entries: MarketplaceEntry[]) => ComponentChildren;
}

/**
 * Loading, failure and empty states around one kind's list. The marketplace always has entries,
 * so an empty list means something is wrong and is shown as an error. A list that's empty only
 * because everything is hidden (already installed) says so instead.
 */
export function MarketplaceEntries({ state, hide, filter, allHidden, onRetry, children }: MarketplaceEntriesProps) {
  if (state?.status === 'loaded') {
    const entries = filter ? state.entries.filter(filter) : state.entries;
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
