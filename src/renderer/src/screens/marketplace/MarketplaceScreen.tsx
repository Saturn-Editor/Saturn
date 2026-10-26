import { useEffect, useState } from 'preact/hooks';
import type { ModuleSummary } from '@shared/modules';
import type { ThemeSummary } from '@shared/types';
import { Badge, Button, SidebarNav, Tabs, TitleBar, Toggle } from '@renderer/components';

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
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const load = () => void window.saturn.modules.list().then(setModules);
  useEffect(() => {
    load();
    return window.saturn.modules.onChanged(load);
  }, []);
  const act = (fn: () => Promise<void>) => void fn().then(() => onError(null), (e) => onError(errorText(e)));

  if (modules.length === 0) return <p class="px-4 text-muted">No languages installed yet. Use Install from folder… to add one.</p>;
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
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const load = () => void window.saturn.themes.list().then(setThemes);
  useEffect(() => {
    load();
    return window.saturn.themes.onListChanged(load);
  }, []);
  return (
    <>
      {themes.map((t) => (
        <Row key={t.id} badge={t.type === 'dark' ? 'D' : 'L'} title={t.name} detail={t.builtIn ? 'Built in' : `${t.type === 'dark' ? 'Dark' : 'Light'} theme`}>
          {!t.builtIn && (
            <Button onClick={() => void window.saturn.themes.uninstall(t.id).then(() => onError(null), (e) => onError(errorText(e)))}>Uninstall</Button>
          )}
        </Row>
      ))}
    </>
  );
}

/** Marketplace window: Themes / Languages, each with Available (coming soon) and Installed. */
export function MarketplaceScreen() {
  const initial = window.saturn.window.section === 'languages' ? 'languages' : 'themes';
  const [section, setSection] = useState<Section>(initial);
  const [tab, setTab] = useState<Tab>('installed');
  const [error, setError] = useState<string | null>(null);

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
      <TitleBar>Marketplace</TitleBar>
      <div class="flex flex-1 min-h-0">
        <SidebarNav<Section>
          items={[{ id: 'themes', label: 'Themes' }, { id: 'languages', label: 'Languages' }]}
          selected={section}
          onSelect={(s) => {
            setSection(s);
            setError(null);
          }}
        />
        <main class="flex-1 flex flex-col min-w-0">
          <Tabs<Tab>
            tabs={[{ id: 'available', label: 'Available' }, { id: 'installed', label: 'Installed' }]}
            active={tab}
            onSelect={setTab}
            trailing={<Button testId="install-from-folder" onClick={() => void installFromFolder()}>Install from folder…</Button>}
          />
          {error && <p class="px-4 pt-2 text-accent" role="alert">{error}</p>}
          <div class="flex-1 overflow-y-auto">
            {tab === 'available' ? (
              <div class="h-full flex flex-col items-center justify-center gap-1.5">
                <div class="text-strong">The marketplace is coming soon</div>
                <div class="text-muted">For now, install {section} from a folder.</div>
              </div>
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
