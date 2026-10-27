import { useEffect, useState } from 'preact/hooks';
import {
  bindingFromKeyPress, CUSTOM_PREFIX, formatBinding, KEYMAP_ACTIONS, KEYMAPS, resolveBinding,
  type CustomKeymap, type KeymapChoice, type KeymapId,
} from '@shared/keymaps';
import { MARKETPLACE_INDEX_URL } from '@shared/marketplace';
import { isMac } from '@renderer/commands/keymap';
import { featureKey, LANGUAGE_FEATURES, type ContributionSnapshot, type SettingValue, type SettingValues, type ViewMode } from '@shared/modules';
import { FILE_ENCODINGS, TEXT_SIZES, type AppSettings, type BranchSwitchMode, type FileEncoding, type ThemeSummary, type UpdateStatus } from '@shared/types';
import { Button, FieldInput, ModuleIcon, FormField, Heading, RadioList, SegmentedControl, Select, SidebarMenu, TabMenu, TextInput, Toggle } from '@renderer/components';
import { ModeToggle } from '@renderer/theme/ModeToggle';

/** Built-in sections, then one per module that declares settings ("module:<id>"). */
type Section = 'appearance' | 'editor' | 'languages' | 'keymap' | 'marketplace' | 'advanced' | `module:${string}`;

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
      <div class="flex items-center gap-3 mb-3">
        <span class="flex-1">Auto-close brackets and quotes ( [ {'{'} &lt; ' ")</span>
        <Toggle on={settings.autoCloseBrackets} label={settings.autoCloseBrackets ? 'Turn off auto-closing' : 'Turn on auto-closing'} onChange={(on) => update({ autoCloseBrackets: on })} />
      </div>
      <div class="flex items-center gap-3 mb-3">
        <span class="flex-1">Format on save (languages that support formatting)</span>
        <Toggle on={settings.formatOnSave} label={settings.formatOnSave ? 'Turn off format on save' : 'Turn on format on save'} onChange={(on) => update({ formatOnSave: on })} />
      </div>
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
    </section>
  );
}

/** What the update status means, in words. */
function updateText(s: UpdateStatus): string {
  switch (s.state) {
    case 'unavailable': return 'Updates are only available in installed builds of Saturn.';
    case 'checking': return 'Checking for updates…';
    case 'up-to-date': return `Saturn ${__SATURN_VERSION__} is up to date.`;
    case 'downloading': return `Downloading Saturn ${s.version ?? ''}… ${s.percent ?? 0}%`;
    case 'ready': return `Saturn ${s.version} is ready. Restart to install it.`;
    case 'available': return `Saturn ${s.version} is available. This copy can't update itself, so download it and replace the app.`;
    case 'error': return `Couldn't check for updates: ${s.message}`;
    default: return `You're on Saturn ${__SATURN_VERSION__}.`;
  }
}

/** Settings → Advanced: Saturn updates, Git, and Reset Saturn. */
function AdvancedSection() {
  const settings = useAppSettings();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    void window.saturn.updates.status().then(setStatus);
    return window.saturn.updates.onChanged(setStatus);
  }, []);
  if (!settings || !status) return null;
  const busy = status.state === 'checking' || status.state === 'downloading';

  return (
    <section>
      <Heading>Updates</Heading>
      <div class="flex items-center gap-3 mb-3">
        <span class="flex-1">Check for updates automatically (Saturn, and installed languages, extensions and themes)</span>
        <Toggle on={settings.autoUpdate} label={settings.autoUpdate ? 'Turn off automatic updates' : 'Turn on automatic updates'} onChange={(on) => void window.saturn.settings.update({ autoUpdate: on })} />
      </div>
      <p class="mt-0 mb-2.5 text-muted" data-testid="update-status">{updateText(status)}</p>
      <div class="flex gap-2 mb-5">
        {status.state === 'ready' && <Button variant="primary" testId="update-install" onClick={() => void window.saturn.updates.install()}>Restart to update</Button>}
        {status.state === 'available' && <Button variant="primary" testId="update-download" onClick={() => void window.saturn.updates.install()}>Download</Button>}
        {status.state !== 'ready' && <Button testId="update-check" disabled={busy || status.state === 'unavailable'} onClick={() => void window.saturn.updates.check()}>Check for updates</Button>}
      </div>
      <Heading>Git</Heading>
      <p class="mt-0 mb-2 text-muted">When switching branches with uncommitted changes:</p>
      <div class="mb-5">
        <SegmentedControl<BranchSwitchMode>
          label="When switching branches with uncommitted changes"
          value={settings.branchSwitch}
          onChange={(branchSwitch) => void window.saturn.settings.update({ branchSwitch })}
          options={[{ id: 'ask', label: 'Ask each time' }, { id: 'bring', label: 'Bring them along' }, { id: 'shelve', label: 'Shelve for that branch' }]}
        />
      </div>
      <Heading>Reset Saturn</Heading>
      <p class="mt-0 mb-2.5 text-muted">
        Removes all settings, installed languages, extensions and themes, and the recent projects list, then starts
        Saturn over as new. Open windows close without saving. Your project folders on disk are not touched. You'll be asked to confirm.
      </p>
      <Button testId="reset-saturn" onClick={() => void window.saturn.app.reset()}>Reset Saturn…</Button>
    </section>
  );
}

/** Choose a keymap and see its shortcuts. */
/**
 * Choose a keymap and see its shortcuts. "Duplicate…" makes a custom keymap from the selected one; a
 * custom keymap's shortcuts can be changed (click, then press the keys), cleared, or reset to its base.
 */
function KeymapSection() {
  const settings = useAppSettings();
  const [naming, setNaming] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  if (!settings) return null;

  const customs = settings.customKeymaps;
  const selectedCustom = customs.find((c) => `${CUSTOM_PREFIX}${c.id}` === settings.keymap);
  const baseOf = (choice: KeymapChoice): KeymapId => (choice.startsWith(CUSTOM_PREFIX) ? (selectedCustom?.base ?? 'os') : (choice as KeymapId));
  const update = (change: Partial<AppSettings>) => void window.saturn.settings.update(change);
  const saveCustom = (next: CustomKeymap) => update({ customKeymaps: customs.map((c) => (c.id === next.id ? next : c)) });

  const duplicate = (name: string) => {
    const id = `${Date.now().toString(36)}`;
    // A copy of a custom keymap keeps its changes; a copy of a built-in one starts with none.
    const copy: CustomKeymap = { id, name: name.trim(), base: baseOf(settings.keymap), bindings: { ...(selectedCustom?.bindings ?? {}) } };
    update({ customKeymaps: [...customs, copy], keymap: `${CUSTOM_PREFIX}${id}` });
    setNaming(null);
  };

  const options = [
    ...KEYMAPS.map((k) => ({ value: k.id as KeymapChoice, label: k.label })),
    ...customs.map((c) => ({ value: `${CUSTOM_PREFIX}${c.id}` as KeymapChoice, label: `${c.name} (custom)` })),
  ];

  return (
    <section>
      <Heading>Keymap</Heading>
      <div class="flex items-center gap-2 mb-2">
        <Select<KeymapChoice> value={settings.keymap} options={options} onChange={(keymap) => update({ keymap })} />
        <Button testId="keymap-duplicate" onClick={() => setNaming(`${options.find((o) => o.value === settings.keymap)?.label.replace(/ \(custom\)$/, '') ?? 'Keymap'} copy`)}>Duplicate…</Button>
        {selectedCustom && <Button testId="keymap-delete" onClick={() => update({ customKeymaps: customs.filter((c) => c.id !== selectedCustom.id) })}>Delete</Button>}
      </div>
      {naming !== null && (
        <div class="flex items-center gap-2 mb-2">
          <TextInput value={naming} onInput={setNaming} placeholder="Keymap name" testId="keymap-name" autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && naming.trim()) duplicate(naming);
              if (e.key === 'Escape') setNaming(null);
            }}
          />
          <Button variant="primary" disabled={!naming.trim()} onClick={() => duplicate(naming)}>Create</Button>
          <Button onClick={() => setNaming(null)}>Cancel</Button>
        </div>
      )}
      <p class="mt-0 mb-5 text-muted text-[11px]">
        {selectedCustom ? `Based on ${KEYMAPS.find((k) => k.id === selectedCustom.base)?.label}. Click a shortcut, then press the new keys.` : 'Duplicate a keymap to change its shortcuts.'}
      </p>
      <Heading>Shortcuts</Heading>
      {KEYMAP_ACTIONS.map((a) => {
        const binding = resolveBinding(a.id, settings.keymap, customs, isMac);
        const changed = !!selectedCustom && a.id in selectedCustom.bindings;
        const set = (value: string | null | undefined) => {
          if (!selectedCustom) return;
          const bindings = { ...selectedCustom.bindings };
          if (value === undefined) delete bindings[a.id];
          else bindings[a.id] = value;
          saveCustom({ ...selectedCustom, bindings });
        };
        return (
          <div key={a.id} class="flex items-center gap-3 py-1 border-b border-divider" data-testid={`shortcut-${a.id}`}>
            <span class="flex-1">{a.title}{changed && <span class="text-muted"> (changed)</span>}</span>
            {selectedCustom ? (
              <>
                <button
                  type="button"
                  data-testid={`shortcut-record-${a.id}`}
                  class={`min-w-28 h-6 px-2 border text-right font-mono ${recording === a.id ? 'border-accent text-accent' : 'border-border hover:bg-hover'} ${binding ? 'text-strong' : 'text-muted'}`}
                  onClick={() => setRecording(recording === a.id ? null : a.id)}
                  onBlur={() => recording === a.id && setRecording(null)}
                  onKeyDown={(e) => {
                    if (recording !== a.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape') return setRecording(null);
                    const recorded = bindingFromKeyPress(e, isMac);
                    if (!recorded) return;
                    set(recorded);
                    setRecording(null);
                  }}
                >
                  {recording === a.id ? 'Press keys…' : binding ? formatBinding(binding, isMac) : 'None'}
                </button>
                <Button onClick={() => set(null)} disabled={!binding}>Clear</Button>
                <Button onClick={() => set(undefined)} disabled={!changed}>Reset</Button>
              </>
            ) : (
              <span class={binding ? 'text-strong font-mono' : 'text-muted'}>{binding ? formatBinding(binding, isMac) : 'None'}</span>
            )}
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
  const settings = useAppSettings();
  const [previews, setPreviews] = useState<ContributionSnapshot['previews']>([]);
  useEffect(() => {
    const read = (s: ContributionSnapshot) => setPreviews(s.previews.filter((p) => p.moduleId === tab.moduleId));
    void window.saturn.modules.snapshot().then(read);
    return window.saturn.modules.onChanged(read);
  }, [tab.moduleId]);
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
      {tab.items.length > 0 && <Heading>{tab.moduleName}</Heading>}
      {tab.items.map((s) => (
        <div key={s.id} class="mb-3">
          <FormField label={s.label}>
            <FieldInput field={s} value={values[s.id] ?? ''} onChange={(v) => setValues({ ...values, [s.id]: v })} onCommit={(v) => save(s.id, v)} />
          </FormField>
          {s.description && <p class="-mt-1.5 mb-0 ml-[152px] text-muted text-[11px]">{s.description}</p>}
        </div>
      ))}
      {previews.length > 0 && settings && (
        <>
          {/* How each previewable file type opens; the language suggests one, the user can change it. */}
          <Heading class={tab.items.length ? 'mt-5' : ''}>Default view</Heading>
          {previews.map((p) => (
            <div key={p.id} class="flex items-center gap-3 mb-2" data-testid={`default-view-${p.id}`}>
              <span class="flex-1">{p.label} <span class="text-muted">({p.extensions.join(', ')})</span></span>
              <div class="w-72">
                <SegmentedControl<ViewMode>
                  label={`${p.label} default view`}
                  value={settings.defaultViews[p.id] ?? p.defaultView ?? 'code'}
                  onChange={(view) => void window.saturn.settings.update({ defaultViews: { ...settings.defaultViews, [p.id]: view } })}
                  options={[{ id: 'code', label: 'Code' }, { id: 'split', label: 'Split' }, { id: 'preview', label: 'Preview' }]}
                />
              </div>
            </div>
          ))}
        </>
      )}
      {tab.features.length > 0 && (
        <>
          {/* Every feature, last on the tab: ones the server offers can be switched off for this language; the rest say so. */}
          <Heading class={tab.items.length || previews.length ? 'mt-5' : ''}>Language features</Heading>
          {LANGUAGE_FEATURES.map((f) => {
            const supported = tab.features.includes(f.id);
            const on = values[featureKey(f.id)] !== false;
            return (
              <div key={f.id} class="flex items-center gap-3 mb-2 min-h-5" data-testid={`feature-${f.id}`}>
                <span class={`flex-1 ${supported ? '' : 'text-muted'}`}>{f.label}</span>
                {supported
                  ? <Toggle on={on} label={on ? `Turn off ${f.label.toLowerCase()}` : `Turn on ${f.label.toLowerCase()}`} onChange={(next) => save(featureKey(f.id), next)} />
                  : <span class="text-muted">Not supported</span>}
              </div>
            );
          })}
        </>
      )}
      {error && <p class="mt-1.5 mb-0 text-accent" role="alert">{error}</p>}
    </section>
  );
}

const MODULE_PREFIX = 'module:';

/** Settings → Languages: a tab per installed language with settings or language features. */
function LanguagesSection({ tabs, selected, onSelect }: { tabs: ModuleTab[]; selected: string | null; onSelect: (id: string) => void }) {
  if (tabs.length === 0) return <p class="m-0 text-muted">None.</p>;
  const tab = tabs.find((t) => t.moduleId === selected) ?? tabs[0];
  return (
    <div class="-m-4 flex flex-col" data-testid="settings-languages">
      <TabMenu<string>
        tabs={tabs.map((t) => ({ id: t.moduleId, label: t.moduleName, icon: <ModuleIcon icon={t.icon} badge={t.badge} /> }))}
        active={tab.moduleId}
        onSelect={onSelect}
      />
      <div class="p-4"><ModuleSection key={tab.moduleId} tab={tab} /></div>
    </div>
  );
}

/**
 * Settings: a sidebar of sections in its own window, or a row of tabs when `embedded` in the Welcome
 * window (which already has a sidebar).
 */
export function SettingsScreen({ embedded = false }: { embedded?: boolean }) {
  // A Settings window can be opened on a section, e.g. a module's tab from a notification.
  const requested = embedded ? null : window.saturn.window.section;
  const [section, setSection] = useState<Section>(requested && /^(appearance|editor|languages|keymap|marketplace|advanced|module:.+)$/.test(requested) ? (requested as Section) : 'appearance');
  const [moduleTabs, setModuleTabs] = useState<ModuleTab[]>([]);
  useEffect(() => {
    void window.saturn.modules.snapshot().then((s) => setModuleTabs(s.settings));
    return window.saturn.modules.onChanged((s) => setModuleTabs(s.settings));
  }, []);
  // Languages share one Languages section (a tab each inside it); extensions get their own sections.
  const [languageIds, setLanguageIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const read = (s: ContributionSnapshot) => setLanguageIds(new Set(s.languages.map((l) => l.moduleId)));
    void window.saturn.modules.snapshot().then(read);
    return window.saturn.modules.onChanged(read);
  }, []);
  const languageTabs = moduleTabs.filter((t) => languageIds.has(t.moduleId));
  const extensionTabs = moduleTabs.filter((t) => !languageIds.has(t.moduleId));
  // A request for a language's own tab ("module:<id>") opens Languages on it.
  const [languageId, setLanguageId] = useState<string | null>(null);
  const requestedLanguage = section.startsWith(MODULE_PREFIX) ? languageTabs.find((t) => section === `${MODULE_PREFIX}${t.moduleId}`) : undefined;
  useEffect(() => {
    if (!requestedLanguage) return;
    setLanguageId(requestedLanguage.moduleId);
    setSection('languages');
  }, [requestedLanguage?.moduleId]);
  const moduleTab = extensionTabs.find((t) => section === `${MODULE_PREFIX}${t.moduleId}`);
  const sections = [
    { id: 'appearance' as Section, label: 'Appearance' },
    { id: 'editor' as Section, label: 'Editor' },
    { id: 'languages' as Section, label: 'Languages' },
    { id: 'keymap' as Section, label: 'Keymap' },
    { id: 'marketplace' as Section, label: 'Marketplace' },
    { id: 'advanced' as Section, label: 'Advanced' },
    // Tabs added by installed extensions, below a divider.
    ...extensionTabs.map((t, i) => ({
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
          {section === 'languages' && <LanguagesSection tabs={languageTabs} selected={languageId} onSelect={setLanguageId} />}
          {section === 'keymap' && <KeymapSection />}
          {section === 'marketplace' && <MarketplaceSection />}
          {section === 'advanced' && <AdvancedSection />}
          {moduleTab && <ModuleSection key={moduleTab.moduleId} tab={moduleTab} />}
        </main>
      </div>
    </div>
  );
}
