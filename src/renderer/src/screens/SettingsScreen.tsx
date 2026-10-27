import { useEffect, useState } from 'preact/hooks';
import { bindingFor, formatBinding, KEYMAP_ACTIONS, KEYMAPS, type KeymapId } from '@shared/keymaps';
import { MARKETPLACE_INDEX_URL } from '@shared/marketplace';
import { isMac } from '@renderer/commands/keymap';
import type { ContributionSnapshot, SettingValue, SettingValues } from '@shared/modules';
import { FILE_ENCODINGS, TEXT_SIZES, type AppSettings, type FileEncoding, type ThemeSummary } from '@shared/types';
import { Button, FieldInput, ModuleIcon, FormField, Heading, RadioList, SegmentedControl, Select, SidebarMenu, TabMenu, TextInput, Toggle } from '@renderer/components';
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

type EditorTab = 'behaviour' | 'smartcode';

/** Settings → Editor, with two tabs: Behaviour (indentation, encoding, reset) and SmartCode (completion). */
function EditorSection() {
  const [tab, setTab] = useState<EditorTab>('behaviour');
  return (
    <div class="-m-4 flex flex-col">
      <TabMenu<EditorTab> tabs={[{ id: 'behaviour', label: 'Behaviour' }, { id: 'smartcode', label: 'SmartCode' }]} active={tab} onSelect={setTab} />
      <div class="p-4">{tab === 'behaviour' ? <BehaviourSection /> : <SmartCodeSection />}</div>
    </div>
  );
}

/** Code completion from the language's server. */
function SmartCodeSection() {
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
      <Heading class="mt-5">Error detection</Heading>
      <div class="flex items-center gap-3">
        <span class="flex-1">Underline errors and warnings from the language, and count them in the status bar</span>
        <Toggle
          on={settings.diagnostics}
          label={settings.diagnostics ? 'Turn off error detection' : 'Turn on error detection'}
          onChange={(on) => void window.saturn.settings.update({ diagnostics: on })}
        />
      </div>
    </section>
  );
}

/** Editor → Behaviour: indentation, file encoding, and Reset Saturn as the last setting. */
function BehaviourSection() {
  const settings = useAppSettings();
  if (!settings) return null;
  const update = (change: Partial<AppSettings>) => void window.saturn.settings.update(change);
  return (
    <section>
      <Heading>Indentation</Heading>
      <div class="flex items-center gap-3 mb-3">
        <span class="flex-1">Auto-indent new lines</span>
        <Toggle on={settings.autoIndent} label={settings.autoIndent ? 'Turn off auto-indent' : 'Turn on auto-indent'} onChange={(on) => update({ autoIndent: on })} />
      </div>
      <div class="flex items-center gap-3 mb-3">
        <span class="flex-1">Indent with</span>
        <div class="w-48">
          <SegmentedControl
            label="Indent with"
            value={settings.indentWith}
            onChange={(indentWith) => update({ indentWith })}
            options={[{ id: 'spaces', label: 'Spaces' }, { id: 'tab', label: 'Tab' }]}
          />
        </div>
      </div>
      {settings.indentWith === 'spaces' && (
        <div class="flex items-center gap-3 mb-5">
          <span class="flex-1">Spaces per indent</span>
          <Select
            value={String(settings.indentSize)}
            options={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' }]}
            onChange={(v) => update({ indentSize: Number(v) as 2 | 4 | 8 })}
          />
        </div>
      )}
      <Heading class="mt-5">Auto-save</Heading>
      <div class="mb-1">
        <SegmentedControl
          label="Auto-save"
          value={settings.autoSave}
          onChange={(autoSave) => update({ autoSave })}
          options={[
            { id: 'typing', label: 'While typing' },
            { id: 'idle', label: 'When I stop or close' },
            { id: 'off', label: 'Off' },
          ]}
        />
      </div>
      <p class="mt-1 mb-0 text-muted text-[11px]">
        {settings.autoSave === 'typing' && 'Saves at most every 2 seconds while you type.'}
        {settings.autoSave === 'idle' && 'Saves a second after you stop typing, when you close a file, and when you leave the window.'}
        {settings.autoSave === 'off' && 'Files save only when you choose Save.'}
      </p>
      <Heading class="mt-5">Encoding</Heading>
      <div class="flex items-center gap-3">
        <span class="flex-1">Read and save files as</span>
        <Select<FileEncoding> value={settings.encoding} options={FILE_ENCODINGS.map((e) => ({ value: e.id, label: e.id === 'utf-8' ? `${e.label} (default)` : e.label }))} onChange={(encoding) => update({ encoding })} />
      </div>
      <Heading class="mt-5">Reset Saturn</Heading>
      <p class="mt-0 mb-2.5 text-muted">
        Removes all settings, installed languages, extensions and themes, and the recent projects list, then restarts
        Saturn as new. Your project folders on disk are not touched. You'll be asked to confirm.
      </p>
      <Button testId="reset-saturn" onClick={() => void window.saturn.app.reset()}>Reset Saturn…</Button>
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

/**
 * Settings: a sidebar of sections in its own window, or a row of tabs when `embedded` in the Welcome
 * window (which already has a sidebar).
 */
export function SettingsScreen({ embedded = false }: { embedded?: boolean }) {
  // A Settings window can be opened on a section, e.g. a module's tab from a notification.
  const requested = embedded ? null : window.saturn.window.section;
  const [section, setSection] = useState<Section>(requested && /^(appearance|editor|keymap|marketplace|module:.+)$/.test(requested) ? (requested as Section) : 'appearance');
  const [moduleTabs, setModuleTabs] = useState<ModuleTab[]>([]);
  useEffect(() => {
    void window.saturn.modules.snapshot().then((s) => setModuleTabs(s.settings));
    return window.saturn.modules.onChanged((s) => setModuleTabs(s.settings));
  }, []);
  const moduleTab = moduleTabs.find((t) => section === `${MODULE_PREFIX}${t.moduleId}`);
  const sections = [
    { id: 'appearance' as Section, label: 'Appearance' },
    { id: 'editor' as Section, label: 'Editor' },
    { id: 'keymap' as Section, label: 'Keymap' },
    { id: 'marketplace' as Section, label: 'Marketplace' },
    // Tabs added by installed languages and extensions, below a divider.
    ...moduleTabs.map((t, i) => ({
      id: `${MODULE_PREFIX}${t.moduleId}` as Section,
      label: t.moduleName,
      icon: <ModuleIcon icon={t.icon} badge={t.badge} />,
      dividerBefore: i === 0,
    })),
  ];

  return (
    <div class="flex flex-col h-full" data-testid="screen-settings">
      {embedded && <TabMenu<Section> tabs={sections} active={section} onSelect={setSection} />}
      <div class="flex flex-1 min-h-0">
        {!embedded && <SidebarMenu<Section> items={sections} selected={section} onSelect={setSection} />}
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
