import { useState } from 'preact/hooks';
import type { MarketplaceLanguage, MarketplaceTheme } from '@shared/marketplace';
import { SATURN_API_VERSION, satisfiesCaret } from '@shared/modules';
import type { ThemeMode, ThemeSummary } from '@shared/types';
import { Badge, Button, ContextMenu, SidebarMenu, TabMenu, Toggle } from '@renderer/components';
import { MODE_LABELS } from '@renderer/theme/ModeToggle';
import {
  isUpToDate, MarketplaceEntries, useInstalledModules, useInstalledThemes, useMarketplaceIndex, type IndexState,
} from '@renderer/screens/MarketplaceIndex';

type Section = 'themes' | 'languages';
type Tab = 'available' | 'installed';

function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

function Row({ badge, title, version, detail, children }: { badge: string; title: string; version?: string; detail: string; children?: preact.ComponentChildren }) {
  return (
    <div class="flex items-center gap-3 px-4 py-2.5 border-b border-divider" data-testid="marketplace-item">
      <Badge text={badge} class="size-8 text-[10px]" />
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

function InstalledLanguages({ onError }: { onError: (m: string | null) => void }) {
  const modules = useInstalledModules();
  const act = (fn: () => Promise<void>) => void fn().then(() => onError(null), (e) => onError(errorText(e)));

  if (modules.length === 0) {
    return (
      <div class="h-full flex flex-col items-center justify-center gap-1.5">
        <div class="text-strong">No languages installed yet</div>
        <div class="text-muted">Install one from Available, or use Install from folder….</div>
      </div>
    );
  }
  return (
    <>
      {modules.map((m) => (
        <Row key={m.id} badge={m.badge} title={m.name} version={m.version} detail={m.incompatible ?? ([m.languages.join(' '), m.description].filter(Boolean).join(' · ') || m.id)}>
          <Toggle on={m.enabled} label={m.enabled ? `Disable ${m.name}` : `Enable ${m.name}`} onChange={(on) => act(() => window.saturn.modules.setEnabled(m.id, on))} />
          <Button onClick={() => act(() => window.saturn.modules.uninstall(m.id))}>Uninstall</Button>
        </Row>
      ))}
    </>
  );
}

function InstalledThemes({ onError }: { onError: (m: string | null) => void }) {
  const themes = useInstalledThemes();
  const [applyMenu, setApplyMenu] = useState<{ x: number; y: number; theme: ThemeSummary } | null>(null);

  /** Makes the theme active in the chosen variant. */
  const apply = (id: string, mode: ThemeMode) => {
    void window.saturn.themes.setActive(id).then(() => window.saturn.themes.setMode(mode)).then(() => onError(null), (e) => onError(errorText(e)));
  };

  return (
    <>
      {themes.map((t) => (
        <Row key={t.id} badge={t.name.slice(0, 2).toUpperCase()} title={t.name} version={t.version ?? undefined} detail={[t.description, t.builtIn ? 'Built in' : ''].filter(Boolean).join(' · ')}>
          {!t.builtIn && (
            <Button onClick={() => void window.saturn.themes.uninstall(t.id).then(() => onError(null), (e) => onError(errorText(e)))}>Uninstall</Button>
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
          items={applyMenu.theme.modes.map((m) => ({ id: m, label: MODE_LABELS[m], testId: `apply-${m}` }))}
          onPick={(m) => apply(applyMenu.theme.id, m as ThemeMode)}
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

/** Languages not yet installed, or with a newer version; up-to-date ones live in Installed. */
function AvailableLanguages({ index, onRetry, onError }: AvailableProps) {
  const installed = useInstalledModules();
  const [installing, install] = useInstaller((id) => window.saturn.marketplace.installLanguage(id), onError);
  return (
    <MarketplaceEntries
      state={index}
      pick={(i) => i.languages}
      hide={(l) => isUpToDate(installed, l)}
      allHidden="You've installed every available language."
      onRetry={onRetry}
    >
      {(entries: MarketplaceLanguage[]) => entries.map((l) => {
        const compatible = satisfiesCaret(l.saturnApi, SATURN_API_VERSION);
        const detail = compatible ? [l.description, l.author].filter(Boolean).join(' · ') : `Needs Saturn API ${l.saturnApi}; this version provides ${SATURN_API_VERSION}`;
        return (
          <Row key={l.id} badge={l.badge ?? l.name.slice(0, 2).toUpperCase()} title={l.name} version={l.version} detail={detail}>
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
        <Row key={t.id} badge={t.name.slice(0, 2).toUpperCase()} title={t.name} version={t.version} detail={[t.description, t.author].filter(Boolean).join(' · ')}>
          <InstallButton update={installed.some((i) => i.id === t.id)} busy={installing === t.id} disabled={installing !== null} onClick={() => install(t.id)} />
        </Row>
      ))}
    </MarketplaceEntries>
  );
}

/** Marketplace window: Themes / Languages, each with Available (from the GitHub-hosted index) and Installed. */
export function MarketplaceScreen() {
  const initial = window.saturn.window.section === 'languages' ? 'languages' : 'themes';
  const [section, setSection] = useState<Section>(initial);
  const [tab, setTab] = useState<Tab>('installed');
  const [error, setError] = useState<string | null>(null);
  // The index is fetched the first time Available is shown, then kept for the window's lifetime.
  const [index, reloadIndex] = useMarketplaceIndex(tab === 'available');

  const installFromFolder = async () => {
    setError(null);
    try {
      const installed = section === 'languages' ? await window.saturn.modules.installDialog() : await window.saturn.themes.installDialog();
      if (installed) setTab('installed');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div class="flex flex-col h-full" data-testid="screen-marketplace">
      <div class="flex flex-1 min-h-0">
        <SidebarMenu<Section>
          items={[{ id: 'themes', label: 'Themes' }, { id: 'languages', label: 'Languages' }]}
          selected={section}
          onSelect={(s) => {
            setSection(s);
            setError(null);
          }}
        />
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
              section === 'languages'
                ? <AvailableLanguages index={index} onRetry={reloadIndex} onError={setError} />
                : <AvailableThemes index={index} onRetry={reloadIndex} onError={setError} />
            ) : section === 'languages' ? (
              <InstalledLanguages onError={setError} />
            ) : (
              <InstalledThemes onError={setError} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
