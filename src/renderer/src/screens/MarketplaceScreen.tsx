import { useState } from 'preact/hooks';
import { chooseVersion, type MarketplaceEntry, type MarketplaceKind } from '@shared/marketplace';
import type { ModuleKind } from '@shared/modules';
import type { ThemeMode, ThemeSummary } from '@shared/types';
import { Button, ContextMenu, ModuleIcon, SidebarMenu, TabMenu, Toggle } from '@renderer/components';
import { MODE_LABELS } from '@renderer/theme/ModeToggle';
import {
  isUpToDate, MarketplaceEntries, updateFor, useInstalledModules, useInstalledThemes, useMarketplaceList, type ListState,
} from '@renderer/screens/MarketplaceIndex';

type Section = MarketplaceKind;
type Tab = 'available' | 'installed';

function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

/** One item. `icon` is its picture (installed icon, or Marketplace image URL); `badge` is its alt text. */
function Row({ badge, icon, title, version, detail, children }: { badge: string; icon?: string | null; title: string; version?: string; detail: string; children?: preact.ComponentChildren }) {
  return (
    <div class="flex items-center gap-3 px-4 py-2.5 border-b border-divider" data-testid="marketplace-item">
      <ModuleIcon icon={icon} badge={badge} class="size-8 text-[10px]" />
      <div class="flex-1 min-w-0">
        <div class="text-strong font-semibold truncate">
          {title} {version && <span class="text-muted font-normal">{version}</span>}
        </div>
        <div class="text-muted truncate">{detail}</div>
      </div>
      {children}
    </div>
  );
}

/** A disabled button that still explains itself on hover (disabled buttons don't get hover themselves). */
function Blocked({ label, reason }: { label: string; reason: string }) {
  return <span title={reason} data-testid="needs-newer-saturn"><Button disabled>{label}</Button></span>;
}

/** An installed item's Update button: active for a version this Saturn supports, greyed out for one that needs a newer Saturn. */
function UpdateButton({ entry, version, onUpdate }: { entry: MarketplaceEntry | undefined; version: string | null; onUpdate: () => void }) {
  const { canUpdateTo, needsNewerSaturn } = updateFor(entry, version);
  if (canUpdateTo) return <Button variant="primary" testId={`update-${entry!.id}`} onClick={onUpdate}>Update to {canUpdateTo}</Button>;
  if (needsNewerSaturn) return <Blocked label={`Update to ${needsNewerSaturn}`} reason={`You need to update Saturn to install version ${needsNewerSaturn}`} />;
  return null;
}

function listEntry(list: ListState | null, id: string): MarketplaceEntry | undefined {
  return list?.status === 'loaded' ? list.entries.find((e) => e.id === id) : undefined;
}

/** Per kind of code module: its API, wording and marketplace install. */
const MODULE_KINDS = {
  language: {
    plural: 'languages', api: () => window.saturn.languages,
    install: (id: string) => window.saturn.marketplace.installLanguage(id),
  },
  extension: {
    plural: 'extensions', api: () => window.saturn.extensions,
    install: (id: string) => window.saturn.marketplace.installExtension(id),
  },
} as const;

function InstalledModules({ kind, list, onError }: { kind: ModuleKind; list: ListState | null; onError: (m: string | null) => void }) {
  const k = MODULE_KINDS[kind];
  const modules = useInstalledModules(kind);
  const act = (fn: () => Promise<void>) => void fn().then(() => onError(null), (e) => onError(errorText(e)));

  if (modules.length === 0) {
    return (
      <div class="h-full flex flex-col items-center justify-center gap-1.5">
        <div class="text-strong">No {k.plural} installed yet</div>
        <div class="text-muted">Install one from Available, or use Install from folder….</div>
      </div>
    );
  }
  return (
    <>
      {modules.map((m) => (
        <Row key={m.id} badge={m.badge} icon={m.icon} title={m.name} version={m.version} detail={m.incompatible ?? ([m.languages.join(' '), m.description].filter(Boolean).join(' · ') || m.id)}>
          <Toggle on={m.enabled} label={m.enabled ? `Disable ${m.name}` : `Enable ${m.name}`} onChange={(on) => act(() => window.saturn.modules.setEnabled(m.id, on))} />
          <UpdateButton entry={listEntry(list, m.id)} version={m.version} onUpdate={() => act(() => k.install(m.id))} />
          <Button onClick={() => act(() => k.api().uninstall(m.id))}>Uninstall</Button>
        </Row>
      ))}
    </>
  );
}

function InstalledThemes({ list, onError }: { list: ListState | null; onError: (m: string | null) => void }) {
  const themes = useInstalledThemes();
  const [applyMenu, setApplyMenu] = useState<{ x: number; y: number; theme: ThemeSummary } | null>(null);
  const act = (fn: () => Promise<unknown>) => void fn().then(() => onError(null), (e) => onError(errorText(e)));

  /** Makes the theme active in the chosen variant, or following the OS ("sync"). */
  const apply = (id: string, choice: ThemeMode | 'sync') => act(() => window.saturn.themes.setActive(id)
    .then(() => (choice === 'sync' ? window.saturn.themes.setSyncWithOs(true) : window.saturn.themes.setMode(choice))));

  return (
    <>
      {themes.map((t) => (
        <Row key={t.id} badge={t.name.slice(0, 2).toUpperCase()} icon={t.icon} title={t.name} version={t.version ?? undefined} detail={[t.description, t.builtIn ? 'Built in' : ''].filter(Boolean).join(' · ')}>
          {!t.builtIn && (
            <>
              <UpdateButton entry={listEntry(list, t.id)} version={t.version} onUpdate={() => act(() => window.saturn.marketplace.installTheme(t.id))} />
              <Button onClick={() => act(() => window.saturn.themes.uninstall(t.id))}>Uninstall</Button>
            </>
          )}
          {/* Apply stays rightmost so it lines up on every row. Its menu lists only the variants the theme has. */}
          <span
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              // Right-aligned with the button (the menu is w-32 = 128px), so it can't run off the window.
              setApplyMenu({ x: r.right - 128, y: r.bottom + 2, theme: t });
            }}
          >
            <Button testId={`apply-${t.id}`}>Apply</Button>
          </span>
        </Row>
      ))}
      {applyMenu && (
        <ContextMenu
          at={applyMenu}
          class="w-32"
          items={[
            ...applyMenu.theme.modes.map((m) => ({ id: m, label: MODE_LABELS[m], testId: `apply-${m}` })),
            // Following the OS only makes sense when the theme has both variants.
            ...(applyMenu.theme.modes.length === 2 ? [{ id: 'sync', label: 'Sync with OS', testId: 'apply-sync' }] : []),
          ]}
          onPick={(choice) => apply(applyMenu.theme.id, choice as ThemeMode | 'sync')}
          onClose={() => setApplyMenu(null)}
        />
      )}
    </>
  );
}

interface AvailableProps {
  list: ListState | null;
  onRetry: () => void;
  onError: (m: string | null) => void;
}

/** Runs one marketplace install at a time, reporting failures; returns the id being installed. */
function useInstaller(run: (id: string) => Promise<unknown>, onError: (m: string | null) => void): [string | null, (id: string) => void] {
  const [installing, setInstalling] = useState<string | null>(null);
  const install = (id: string) => {
    onError(null);
    setInstalling(id);
    void run(id).then(() => onError(null), (e) => onError(errorText(e))).finally(() => setInstalling(null));
  };
  return [installing, install];
}

/**
 * Entries not yet installed, or with a newer version this Saturn supports; up-to-date ones live in
 * Installed. Each offers the newest compatible version. One with no compatible version is greyed out.
 */
function AvailableList({ list, onRetry, onError, noun, installed, install: run }: AvailableProps & {
  noun: string;
  installed: { id: string; version: string | null }[];
  install: (id: string) => Promise<unknown>;
}) {
  const [installing, install] = useInstaller(run, onError);
  return (
    <MarketplaceEntries state={list} hide={(e) => isUpToDate(installed, e)} allHidden={`You've installed every available ${noun}.`} onRetry={onRetry}>
      {(entries) => entries.map((e) => {
        const { installable, latest } = chooseVersion(e);
        const shown = installable ?? latest;
        const update = installed.some((i) => i.id === e.id);
        const detail = installable ? [e.description, e.author].filter(Boolean).join(' · ') : `Needs a newer Saturn (module API ${latest.saturnApi})`;
        return (
          <Row key={e.id} badge={e.name.slice(0, 2).toUpperCase()} icon={e.image} title={e.name} version={shown.version} detail={detail}>
            {installable ? (
              <Button variant="primary" disabled={installing !== null} onClick={() => install(e.id)}>
                {installing === e.id ? 'Installing…' : update ? 'Update' : 'Install'}
              </Button>
            ) : (
              <Blocked label={update ? 'Update' : 'Install'} reason={`You need to update Saturn to install ${e.name} ${latest.version}`} />
            )}
          </Row>
        );
      })}
    </MarketplaceEntries>
  );
}

function AvailableModules({ kind, ...props }: AvailableProps & { kind: ModuleKind }) {
  const installed = useInstalledModules(kind);
  return <AvailableList {...props} noun={kind} installed={installed} install={MODULE_KINDS[kind].install} />;
}

function AvailableThemes(props: AvailableProps) {
  const installed = useInstalledThemes();
  return <AvailableList {...props} noun="theme" installed={installed} install={(id) => window.saturn.marketplace.installTheme(id)} />;
}

const SECTION_KINDS: Partial<Record<Section, ModuleKind>> = { languages: 'language', extensions: 'extension' };

/** Marketplace window: Themes / Languages / Extensions, each with Available (from the GitHub-hosted lists) and Installed. */
export function MarketplaceScreen({ embedded = false }: { embedded?: boolean }) {
  const sections: { id: Section; label: string }[] = [{ id: 'themes', label: 'Themes' }, { id: 'languages', label: 'Languages' }, { id: 'extensions', label: 'Extensions' }];
  const requested = window.saturn.window.section;
  const initial: Section = requested === 'languages' || requested === 'extensions' ? requested : 'themes';
  const [section, setSection] = useState<Section>(initial);
  const [tab, setTab] = useState<Tab>('installed');
  const [error, setError] = useState<string | null>(null);
  // Only the open section's list is fetched; Installed uses it to offer updates.
  const [list, reloadList] = useMarketplaceList(section);
  const kind = SECTION_KINDS[section];
  const pickSection = (s: Section) => {
    setSection(s);
    setError(null);
  };

  const installFromFolder = async () => {
    setError(null);
    try {
      const installed = kind ? await MODULE_KINDS[kind].api().installDialog() : await window.saturn.themes.installDialog();
      if (installed) setTab('installed');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div class="flex flex-col h-full" data-testid="screen-marketplace">
      {/* Embedded in the Welcome window (which has its own sidebar), the sections are tabs instead. */}
      {embedded && <TabMenu<Section> tabs={sections} active={section} onSelect={pickSection} />}
      <div class="flex flex-1 min-h-0">
        {!embedded && <SidebarMenu<Section> items={sections} selected={section} onSelect={pickSection} />}
        <main class="flex-1 flex flex-col min-w-0">
          <TabMenu<Tab>
            tabs={[{ id: 'available', label: 'Available' }, { id: 'installed', label: 'Installed' }]}
            active={tab}
            onSelect={setTab}
            trailing={
              <>
                {/* Fetches this section's list again (new versions, new entries). */}
                <Button testId="marketplace-refresh" disabled={list?.status === 'loading'} onClick={reloadList}>
                  {list?.status === 'loading' ? 'Refreshing…' : 'Refresh'}
                </Button>
                <Button testId="install-from-folder" onClick={() => void installFromFolder()}>Install from folder…</Button>
              </>
            }
          />
          {error && <p class="px-4 pt-2 text-accent" role="alert">{error}</p>}
          <div class="flex-1 overflow-y-auto">
            {tab === 'available' ? (
              kind
                ? <AvailableModules key={kind} kind={kind} list={list} onRetry={reloadList} onError={setError} />
                : <AvailableThemes list={list} onRetry={reloadList} onError={setError} />
            ) : kind ? (
              <InstalledModules key={kind} kind={kind} list={list} onError={setError} />
            ) : (
              <InstalledThemes list={list} onError={setError} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
