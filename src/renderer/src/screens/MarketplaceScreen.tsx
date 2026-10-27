import { useState } from 'preact/hooks';
import type { MarketplaceExtension, MarketplaceLanguage, MarketplaceTheme } from '@shared/marketplace';
import { SATURN_API_VERSION, satisfiesCaret, type ModuleKind } from '@shared/modules';
import type { ThemeMode, ThemeSummary } from '@shared/types';
import { Button, ContextMenu, ModuleIcon, SidebarMenu, TabMenu, Toggle } from '@renderer/components';
import { MODE_LABELS } from '@renderer/theme/ModeToggle';
import {
  isUpToDate, MarketplaceEntries, useInstalledModules, useInstalledThemes, useMarketplaceIndex, type IndexState,
} from '@renderer/screens/MarketplaceIndex';

type Section = 'themes' | 'languages' | 'extensions';
type Tab = 'available' | 'installed';

function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

/** One item. `icon` is its picture (installed icon, or Marketplace image URL); `badge` shows when there's none. */
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

/** The index version of an installed item when it differs (an update is available), else null. */
function newerVersion(index: IndexState | null, kind: 'languages' | 'extensions' | 'themes', id: string, version: string | null): string | null {
  if (index?.status !== 'loaded') return null;
  const entry = index.index[kind].find((e) => e.id === id);
  return entry && entry.version !== version ? entry.version : null;
}

/** Per kind of code module: its index list, API and wording. */
const MODULE_KINDS = {
  language: {
    list: 'languages', plural: 'languages', api: () => window.saturn.languages,
    install: (id: string) => window.saturn.marketplace.installLanguage(id),
  },
  extension: {
    list: 'extensions', plural: 'extensions', api: () => window.saturn.extensions,
    install: (id: string) => window.saturn.marketplace.installExtension(id),
  },
} as const;

function InstalledModules({ kind, index, onError }: { kind: ModuleKind; index: IndexState | null; onError: (m: string | null) => void }) {
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
      {modules.map((m) => {
        const update = newerVersion(index, k.list, m.id, m.version);
        return (
          <Row key={m.id} badge={m.badge} icon={m.icon} title={m.name} version={m.version} detail={m.incompatible ?? ([m.languages.join(' '), m.description].filter(Boolean).join(' · ') || m.id)}>
            <Toggle on={m.enabled} label={m.enabled ? `Disable ${m.name}` : `Enable ${m.name}`} onChange={(on) => act(() => window.saturn.modules.setEnabled(m.id, on))} />
            {update && (
              <Button variant="primary" testId={`update-${m.id}`} onClick={() => act(() => k.install(m.id))}>Update to {update}</Button>
            )}
            <Button onClick={() => act(() => k.api().uninstall(m.id))}>Uninstall</Button>
          </Row>
        );
      })}
    </>
  );
}

function InstalledThemes({ index, onError }: { index: IndexState | null; onError: (m: string | null) => void }) {
  const themes = useInstalledThemes();
  const [applyMenu, setApplyMenu] = useState<{ x: number; y: number; theme: ThemeSummary } | null>(null);

  /** Makes the theme active in the chosen variant, or following the OS ("sync"). */
  const apply = (id: string, choice: ThemeMode | 'sync') => {
    void window.saturn.themes.setActive(id)
      .then(() => (choice === 'sync' ? window.saturn.themes.setSyncWithOs(true) : window.saturn.themes.setMode(choice)))
      .then(() => onError(null), (e) => onError(errorText(e)));
  };

  return (
    <>
      {themes.map((t) => (
        <Row key={t.id} badge={t.name.slice(0, 2).toUpperCase()} icon={t.icon} title={t.name} version={t.version ?? undefined} detail={[t.description, t.builtIn ? 'Built in' : ''].filter(Boolean).join(' · ')}>
          {!t.builtIn && (
            <>
              {newerVersion(index, 'themes', t.id, t.version) && (
                <Button variant="primary" testId={`update-${t.id}`} onClick={() => void window.saturn.marketplace.installTheme(t.id).then(() => onError(null), (e) => onError(errorText(e)))}>
                  Update to {newerVersion(index, 'themes', t.id, t.version)}
                </Button>
              )}
              <Button onClick={() => void window.saturn.themes.uninstall(t.id).then(() => onError(null), (e) => onError(errorText(e)))}>Uninstall</Button>
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
  index: IndexState | null;
  onRetry: () => void;
  onError: (m: string | null) => void;
}

/** Runs one marketplace install at a time, reporting failures; returns the id being installed. */
function useInstaller(run: (id: string) => Promise<void>, onError: (m: string | null) => void): [string | null, (id: string) => void] {
  const [installing, setInstalling] = useState<string | null>(null);
  const install = (id: string) => {
    onError(null);
    setInstalling(id);
    void run(id).then(() => onError(null), (e) => onError(errorText(e))).finally(() => setInstalling(null));
  };
  return [installing, install];
}

/** Install (or Update, when an older version is installed); shows "Installing…" while `busy`. */
function InstallButton({ update, disabled, busy, onClick }: { update: boolean; disabled: boolean; busy: boolean; onClick: () => void }) {
  return (
    <Button variant="primary" disabled={disabled} onClick={onClick}>
      {busy ? 'Installing…' : update ? 'Update' : 'Install'}
    </Button>
  );
}

/** Languages or extensions not yet installed, or with a newer version; up-to-date ones live in Installed. */
function AvailableModules({ kind, index, onRetry, onError }: AvailableProps & { kind: ModuleKind }) {
  const k = MODULE_KINDS[kind];
  const installed = useInstalledModules(kind);
  const [installing, install] = useInstaller(k.install, onError);
  return (
    <MarketplaceEntries
      state={index}
      pick={(i) => i[k.list]}
      hide={(l) => isUpToDate(installed, l)}
      allHidden={`You've installed every available ${kind}.`}
      onRetry={onRetry}
    >
      {(entries: (MarketplaceLanguage | MarketplaceExtension)[]) => entries.map((l) => {
        const compatible = satisfiesCaret(l.saturnApi, SATURN_API_VERSION);
        const detail = compatible ? [l.description, l.author].filter(Boolean).join(' · ') : `Needs Saturn API ${l.saturnApi}; this version provides ${SATURN_API_VERSION}`;
        return (
          <Row key={l.id} badge={l.name.slice(0, 2).toUpperCase()} icon={l.image} title={l.name} version={l.version} detail={detail}>
            <InstallButton update={installed.some((m) => m.id === l.id)} busy={installing === l.id} disabled={!compatible || installing !== null} onClick={() => install(l.id)} />
          </Row>
        );
      })}
    </MarketplaceEntries>
  );
}

/** Themes not yet installed, or with a newer version; up-to-date ones live in Installed. */
function AvailableThemes({ index, onRetry, onError }: AvailableProps) {
  const installed = useInstalledThemes();
  const [installing, install] = useInstaller((id) => window.saturn.marketplace.installTheme(id), onError);
  return (
    <MarketplaceEntries
      state={index}
      pick={(i) => i.themes}
      hide={(t) => isUpToDate(installed, t)}
      allHidden="You've installed every available theme."
      onRetry={onRetry}
    >
      {(entries: MarketplaceTheme[]) => entries.map((t) => (
        <Row key={t.id} badge={t.name.slice(0, 2).toUpperCase()} icon={t.image} title={t.name} version={t.version} detail={[t.description, t.author].filter(Boolean).join(' · ')}>
          <InstallButton update={installed.some((i) => i.id === t.id)} busy={installing === t.id} disabled={installing !== null} onClick={() => install(t.id)} />
        </Row>
      ))}
    </MarketplaceEntries>
  );
}

const SECTION_KINDS: Partial<Record<Section, ModuleKind>> = { languages: 'language', extensions: 'extension' };

/** Marketplace window: Themes / Languages / Extensions, each with Available (from the GitHub-hosted index) and Installed. */
export function MarketplaceScreen({ embedded = false }: { embedded?: boolean }) {
  const sections: { id: Section; label: string }[] = [{ id: 'themes', label: 'Themes' }, { id: 'languages', label: 'Languages' }, { id: 'extensions', label: 'Extensions' }];
  const pickSection = (s: Section) => {
    setSection(s);
    setError(null);
  };
  const requested = window.saturn.window.section;
  const initial: Section = requested === 'languages' || requested === 'extensions' ? requested : 'themes';
  const [section, setSection] = useState<Section>(initial);
  const [tab, setTab] = useState<Tab>('installed');
  const [error, setError] = useState<string | null>(null);
  // Fetched as the window opens and kept for its lifetime, so Installed can offer updates too.
  const [index, reloadIndex] = useMarketplaceIndex();
  const kind = SECTION_KINDS[section];

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
            trailing={<Button testId="install-from-folder" onClick={() => void installFromFolder()}>Install from folder…</Button>}
          />
          {error && <p class="px-4 pt-2 text-accent" role="alert">{error}</p>}
          <div class="flex-1 overflow-y-auto">
            {tab === 'available' ? (
              kind
                ? <AvailableModules key={kind} kind={kind} index={index} onRetry={reloadIndex} onError={setError} />
                : <AvailableThemes index={index} onRetry={reloadIndex} onError={setError} />
            ) : kind ? (
              <InstalledModules key={kind} kind={kind} index={index} onError={setError} />
            ) : (
              <InstalledThemes index={index} onError={setError} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
