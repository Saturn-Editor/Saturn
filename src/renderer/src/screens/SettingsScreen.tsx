import { useEffect, useState } from 'preact/hooks';
import { bindingFor, formatBinding, KEYMAP_ACTIONS, KEYMAPS, type KeymapId } from '@shared/keymaps';
import { MARKETPLACE_INDEX_URL } from '@shared/marketplace';
import { isMac } from '@renderer/commands/keymap';
import type { ContributionSnapshot, SettingValue, SettingValues } from '@shared/modules';
import { TEXT_SIZES, type AppSettings, type ThemeSummary } from '@shared/types';
import { Badge, Button, FieldInput, FormField, Heading, RadioList, Select, SidebarMenu, TextInput, Toggle } from '@renderer/components';
import { ModeToggle } from '@renderer/theme/ModeToggle';

/** Built-in sections, then one per module that declares settings ("module:<id>"). */
type Section = 'appearance' | 'editor' | 'keymap' | 'marketplace' | `module:${string}`;

/** Light/Dark mode (or Sync with OS), the active theme and text size. Also shown on the Welcome screen. */
export function AppearanceSection() {
  const settings = useAppSettings();
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const loadList = () => void window.saturn.themes.list().then(setThemes);
    loadList();
    void window.saturn.themes.active().then((t) => setActiveId(t.id));
    const offList = window.saturn.themes.onListChanged(loadList);
    const offActive = window.saturn.themes.onChanged((t) => setActiveId(t.id));
    return () => {
      offList();
      offActive();
    };
  }, []);

  return (
    <section>
      <Heading>Mode</Heading>
      <div class="mb-5 max-w-80"><ModeToggle /></div>
      <Heading>Theme</Heading>
      <RadioList
        label="Theme"
        items={themes.map((t) => ({ id: t.id, label: t.name, detail: t.builtIn ? 'Built in' : 'Installed' }))}
        value={activeId}
        onChange={(id) => void window.saturn.themes.setActive(id)}
      />
      <Heading class="mt-5">Text size</Heading>
      {settings && (
        <div class="flex items-center gap-3">
          <Select
            value={String(settings.textSize)}
            options={TEXT_SIZES.map((s) => ({ value: String(s), label: s === 100 ? '100% (default)' : `${s}%` }))}
            onChange={(v) => void window.saturn.settings.update({ textSize: Number(v) })}
          />
          <span class="text-muted">Scales text and the interface in every window.</span>
        </div>
      )}
    </section>
  );
}

function errorText(e: unknown): string {
  return String((e as Error).message).replace(/^.*Error: /, '');
}

/** The editable settings, kept in sync with changes from any window. */
function useAppSettings(): AppSettings | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void window.saturn.settings.get().then(setSettings);
    return window.saturn.settings.onChanged(setSettings);
  }, []);
  return settings;
}

function EditorSection() {
  const settings = useAppSettings();
  if (!settings) return null;
  return (
    <section>
      <Heading>Code completion</Heading>
      <div class="flex items-center gap-3">
        <span class="flex-1">Suggest completions from the language while typing</span>
        <Toggle
          on={settings.completion}
          label={settings.completion ? 'Turn off code completion' : 'Turn on code completion'}
          onChange={(on) => void window.saturn.settings.update({ completion: on })}
        />
      </div>
    </section>
  );
}

/** Choose a keymap and see its shortcuts. */
function KeymapSection() {
  const settings = useAppSettings();
  if (!settings) return null;
  return (
    <section>
      <Heading>Keymap</Heading>
      <div class="mb-5">
        <Select<KeymapId> value={settings.keymap} options={KEYMAPS.map((k) => ({ value: k.id, label: k.label }))} onChange={(keymap) => void window.saturn.settings.update({ keymap })} />
      </div>
      <Heading>Shortcuts</Heading>
      {KEYMAP_ACTIONS.map((a) => {
        const binding = bindingFor(a.id, settings.keymap, isMac);
        return (
          <div key={a.id} class="flex gap-3 py-1 border-b border-divider" data-testid={`shortcut-${a.id}`}>
            <span class="flex-1">{a.title}</span>
            <span class={binding ? 'text-strong font-mono' : 'text-muted'}>{binding ? formatBinding(binding, isMac) : 'None'}</span>
          </div>
        );
      })}
    </section>
  );
}

function MarketplaceSection() {
  const settings = useAppSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;

  const value = draft ?? settings.marketplaceUrl;
  const save = (url: string) => {
    setError(null);
    void window.saturn.settings.update({ marketplaceUrl: url }).then(() => setDraft(null), (e) => setError(errorText(e)));
  };

  return (
    <section>
      <Heading>Marketplace</Heading>
      <Button testId="settings-open-marketplace" class="mb-5" onClick={() => window.saturn.windows.openMarketplace()}>Open Marketplace</Button>
      <Heading>Marketplace URL</Heading>
      <p class="mt-0 mb-2.5 text-accent" data-testid="marketplace-url-warning">
        Changing this isn't recommended. Saturn will download and install languages and themes from whatever index this
        points to, so only use a marketplace you trust.
      </p>
      <TextInput value={value} onInput={setDraft} class="w-full" testId="marketplace-url" />
      {error && <p class="mt-1.5 mb-0 text-accent" role="alert">{error}</p>}
      <div class="flex gap-2 mt-2.5">
        <Button variant="primary" disabled={draft === null || draft === settings.marketplaceUrl} onClick={() => save(value)}>Save</Button>
        <Button disabled={settings.marketplaceUrl === MARKETPLACE_INDEX_URL && draft === null} onClick={() => save(MARKETPLACE_INDEX_URL)}>
          Reset to default
        </Button>
      </div>
    </section>
  );
}

type ModuleTab = ContributionSnapshot['settings'][number];

/** A module's own settings tab, e.g. Java's JAR location. Typed text saves when the field loses focus. */
function ModuleSection({ tab }: { tab: ModuleTab }) {
  const [values, setValues] = useState<SettingValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void window.saturn.modules.settings(tab.moduleId).then(setValues);
    return window.saturn.modules.onSettingsChanged((moduleId, next) => moduleId === tab.moduleId && setValues(next));
  }, [tab.moduleId]);
  if (!values) return null;

  const save = (id: string, value: SettingValue) => {
    setError(null);
    void window.saturn.modules.setSetting(tab.moduleId, id, value).catch((e) => setError(errorText(e)));
  };

  return (
    <section data-testid={`module-settings-${tab.moduleId}`}>
      <Heading>{tab.moduleName}</Heading>
      {tab.items.map((s) => (
        <div key={s.id} class="mb-3">
          <FormField label={s.label}>
            <FieldInput field={s} value={values[s.id] ?? ''} onChange={(v) => setValues({ ...values, [s.id]: v })} onCommit={(v) => save(s.id, v)} />
          </FormField>
          {s.description && <p class="-mt-1.5 mb-0 ml-[152px] text-muted text-[11px]">{s.description}</p>}
        </div>
      ))}
      {error && <p class="mt-1.5 mb-0 text-accent" role="alert">{error}</p>}
    </section>
  );
}

const MODULE_PREFIX = 'module:';

export function SettingsScreen() {
  const [section, setSection] = useState<Section>('appearance');
  const [moduleTabs, setModuleTabs] = useState<ModuleTab[]>([]);
  useEffect(() => {
    void window.saturn.modules.snapshot().then((s) => setModuleTabs(s.settings));
    return window.saturn.modules.onChanged((s) => setModuleTabs(s.settings));
  }, []);
  const moduleTab = moduleTabs.find((t) => section === `${MODULE_PREFIX}${t.moduleId}`);

  return (
    <div class="flex flex-col h-full" data-testid="screen-settings">
      <div class="flex flex-1 min-h-0">
        <SidebarMenu<Section>
          items={[
            { id: 'appearance', label: 'Appearance' },
            { id: 'editor', label: 'Editor' },
            { id: 'keymap', label: 'Keymap' },
            { id: 'marketplace', label: 'Marketplace' },
            ...moduleTabs.map((t) => ({ id: `${MODULE_PREFIX}${t.moduleId}` as Section, label: t.moduleName, icon: <Badge text={t.badge} /> })),
          ]}
          selected={section}
          onSelect={setSection}
        />
        <main class="flex-1 p-4 overflow-y-auto">
          {section === 'appearance' && <AppearanceSection />}
          {section === 'editor' && <EditorSection />}
          {section === 'keymap' && <KeymapSection />}
          {section === 'marketplace' && <MarketplaceSection />}
          {moduleTab && <ModuleSection key={moduleTab.moduleId} tab={moduleTab} />}
        </main>
      </div>
    </div>
  );
}
