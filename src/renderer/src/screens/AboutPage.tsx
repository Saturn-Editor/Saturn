import { useEffect, useState } from 'preact/hooks';
import type { ModuleSummary } from '@shared/modules';
import type { AppInfo, ThemeSummary } from '@shared/types';
import { Button, Heading, Logo } from '@renderer/components';
import { useInstalledModules, useInstalledThemes } from './MarketplaceIndex';

/** Open-source software bundled in Saturn. All are MIT licensed. */
const ATTRIBUTIONS: { name: string; by: string }[] = [
  { name: 'Electron', by: 'the Electron community' },
  { name: 'Preact and Preact Signals', by: 'the Preact team' },
  { name: 'CodeMirror', by: 'Marijn Haverbeke and others' },
  { name: 'xterm.js', by: 'the xterm.js authors' },
  { name: 'node-pty', by: 'Microsoft Corporation' },
  { name: 'vscode-textmate, vscode-oniguruma and vscode-jsonrpc', by: 'Microsoft Corporation' },
  { name: 'fflate', by: 'Arjun Barrett' },
  { name: 'Tailwind CSS', by: 'Tailwind Labs' },
];

function InfoRow({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="grid grid-cols-[150px_1fr] gap-3 py-1 border-b border-divider items-center">
      <span class="text-muted">{label}</span>
      <div class="min-w-0">{children}</div>
    </div>
  );
}

/** A name on the left and a muted status pinned to the right, like the credits list. */
function ListRow({ name, status, testId }: { name: preact.ComponentChildren; status: string; testId?: string }) {
  return (
    <div class="flex gap-3 py-1 border-b border-divider" data-testid={testId}>
      <span class="flex-1 text-strong min-w-0 truncate">{name}</span>
      <span class="text-muted text-right">{status}</span>
    </div>
  );
}

function moduleStatus(m: ModuleSummary): string {
  if (m.incompatible) return 'Incompatible';
  return m.enabled ? 'Enabled' : 'Disabled';
}

interface Diagnostics {
  info: AppInfo;
  marketplaceUrl: string;
  modules: ModuleSummary[];
  themes: ThemeSummary[];
  activeTheme: string | null;
}

function diagnosticsText(d: Diagnostics): string {
  const { info } = d;
  return [
    `Saturn ${info.version} (API ${info.saturnApi})`,
    `Electron ${info.electron}, Chromium ${info.chrome}, Node.js ${info.node}, V8 ${info.v8}`,
    `${info.os}, locale ${info.locale}`,
    `Marketplace: ${d.marketplaceUrl}`,
    ...info.folders.map((f) => `${f.label}: ${f.path}`),
    ...(['language', 'extension'] as const).map((kind) => {
      const list = d.modules.filter((m) => m.kind === kind);
      return `${kind === 'language' ? 'Languages' : 'Extensions'}: ${list.map((m) => `${m.name} ${m.version} (${moduleStatus(m)})`).join(', ') || 'none'}`;
    }),
    `Themes: ${d.themes.map((t) => `${t.name}${t.version ? ` ${t.version}` : ''}${t.id === d.activeTheme ? ' (active)' : ''}`).join(', ')}`,
  ].join('\n');
}

/** Welcome → About: logo and version, credits, and diagnostics (versions and storage folders). */
export function AboutPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const languages = useInstalledModules('language');
  const extensions = useInstalledModules('extension');
  const modules = [...languages, ...extensions];
  const themes = useInstalledThemes();
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void window.saturn.app.info().then(setInfo);
    void window.saturn.settings.get().then((s) => setMarketplaceUrl(s.marketplaceUrl));
    void window.saturn.themes.active().then((t) => setActiveTheme(t.id));
    const offSettings = window.saturn.settings.onChanged((s) => setMarketplaceUrl(s.marketplaceUrl));
    const offTheme = window.saturn.themes.onChanged((t) => setActiveTheme(t.id));
    return () => {
      offSettings();
      offTheme();
    };
  }, []);

  const copy = () => {
    if (!info) return;
    const text = diagnosticsText({ info, marketplaceUrl, modules, themes, activeTheme });
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };

  return (
    <main class="flex-1 overflow-y-auto min-w-0" data-testid="welcome-about">
      <div class="max-w-xl mx-auto px-6 py-8 flex flex-col gap-7">
        <div class="flex flex-col items-center gap-2">
          <Logo class="h-16" />
          <div class="text-muted" data-testid="app-version">Version {__SATURN_VERSION__}</div>
        </div>

        <section>
          <Heading>Credits</Heading>
          <p class="mt-0 mb-3">Created by <span class="text-strong font-semibold">Lewis Milburn</span>.</p>
          <p class="mt-0 mb-1.5 text-muted">Saturn is built with this open-source software, used under the MIT License:</p>
          {ATTRIBUTIONS.map((a) => (
            <div key={a.name} class="flex gap-3 py-1 border-b border-divider">
              <span class="flex-1 text-strong">{a.name}</span>
              <span class="text-muted text-right">{a.by}</span>
            </div>
          ))}
        </section>

        <section>
          <Heading>Installed languages</Heading>
          {languages.length === 0 && <p class="m-0 text-muted">None.</p>}
          {languages.map((m) => (
            <ListRow key={m.id} testId={`about-module-${m.id}`} name={<>{m.name} <span class="text-muted font-normal">{m.version}</span></>} status={moduleStatus(m)} />
          ))}
        </section>

        <section>
          <Heading>Installed extensions</Heading>
          {extensions.length === 0 && <p class="m-0 text-muted">None.</p>}
          {extensions.map((m) => (
            <ListRow key={m.id} testId={`about-module-${m.id}`} name={<>{m.name} <span class="text-muted font-normal">{m.version}</span></>} status={moduleStatus(m)} />
          ))}
        </section>

        <section>
          <Heading>Installed themes</Heading>
          {/* Themes can't be turned off; the one in use shows as Active. */}
          {themes.map((t) => (
            <ListRow
              key={t.id}
              testId={`about-theme-${t.id}`}
              name={<>{t.name} {t.version && <span class="text-muted font-normal">{t.version}</span>}</>}
              status={[t.id === activeTheme ? 'Active' : '', t.builtIn ? 'Built in' : ''].filter(Boolean).join(' · ') || 'Installed'}
            />
          ))}
        </section>

        <section>
          <Heading>Diagnostics</Heading>
          {info && (
            <>
              <InfoRow label="Saturn">{info.version} (module API {info.saturnApi})</InfoRow>
              <InfoRow label="Electron">{info.electron}</InfoRow>
              <InfoRow label="Chromium">{info.chrome}</InfoRow>
              <InfoRow label="Node.js">{info.node}</InfoRow>
              <InfoRow label="V8">{info.v8}</InfoRow>
              <InfoRow label="Operating system">{info.os}</InfoRow>
              <InfoRow label="Locale">{info.locale}</InfoRow>
              <InfoRow label="Marketplace">
                <span class="block truncate select-text" title={marketplaceUrl} data-testid="about-marketplace-url">{marketplaceUrl}</span>
              </InfoRow>
              {info.folders.map((f) => (
                <InfoRow key={f.id} label={f.label}>
                  <div class="flex items-center gap-2">
                    <span class="flex-1 truncate select-text" title={f.path}>{f.path}</span>
                    <Button testId={`open-folder-${f.id}`} onClick={() => void window.saturn.app.openFolder(f.id).catch((e) => setProblem(String((e as Error).message).replace(/^.*Error: /, '')))}>
                      Open
                    </Button>
                  </div>
                </InfoRow>
              ))}
              {problem && <p class="mt-1.5 mb-0 text-accent" role="alert">{problem}</p>}
              <Button class="mt-3" testId="copy-diagnostics" onClick={copy}>{copied ? 'Copied' : 'Copy diagnostics'}</Button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
