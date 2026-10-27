import { useEffect, useState } from 'preact/hooks';
import { fieldApplies, settingDefaults, type ContributionSnapshot, type SettingValues } from '@shared/modules';
import {
  Badge, Button, Checkbox, DialogFooter, FieldInput, ModuleIcon, FormField, Heading, SidebarFooterButton, SidebarMenu, TabMenu, TextInput, TitleBar,
} from '@renderer/components';
import { EMPTY_SNAPSHOT } from '@renderer/modules/ModuleBridge';

const PLAIN_TEXT = 'plain-text';

/**
 * New Project: Plain Text or an installed language in the sidebar. A language can offer templates in
 * tabs along the top (e.g. C#: Empty solution, .NET, Web, MAUI) and fields that apply only to some of
 * them. Creating can take a while; the language's progress messages show on the Create button's left.
 */
export function NewProjectScreen() {
  const [modules, setModules] = useState<ContributionSnapshot>(EMPTY_SNAPSHOT);
  const [kind, setKind] = useState(PLAIN_TEXT);
  const [name, setName] = useState('untitled');
  const [parentDir, setParentDir] = useState('');
  const [gitInit, setGitInit] = useState(false);
  const [fields, setFields] = useState<SettingValues>({});
  const [tab, setTab] = useState<string | undefined>(undefined);
  const [template, setTemplate] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    void window.saturn.projects.defaultParentDir().then(setParentDir);
    void window.saturn.modules.snapshot().then(setModules);
    const offModules = window.saturn.modules.onChanged(setModules);
    const offProgress = window.saturn.projects.onCreateProgress(setProgress);
    return () => {
      offModules();
      offProgress();
    };
  }, []);

  const language = modules.newProject.find((n) => n.language === kind);
  useEffect(() => {
    setFields(settingDefaults(language?.fields ?? []));
    // Start on the first tab's first template.
    const first = language?.tabs?.[0];
    setTab(first?.id);
    setTemplate(first?.templates[0]?.id);
  }, [kind, language]);

  const currentTab = language?.tabs?.find((t) => t.id === tab);
  const choice = { tab, template };
  const shownFields = (language?.fields ?? []).filter((f) => fieldApplies(f, choice));

  const browse = async () => {
    const picked = await window.saturn.projects.pickFolder();
    if (picked) setParentDir(picked);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    // Only the fields that apply to the chosen template are sent, plus the tab and template.
    const sent: SettingValues = Object.fromEntries(shownFields.map((f) => [f.id, fields[f.id] ?? '']));
    if (tab) sent.tab = tab;
    if (template) sent.template = template;
    try {
      await window.saturn.projects.create({ name, parentDir, gitInit, languageId: language?.language ?? null, fields: sent });
    } catch (e) {
      // Electron prefixes IPC errors with "Error invoking remote method '…': Error: ".
      setError(String((e as Error).message).replace(/^.*Error: /, ''));
      setBusy(false);
      setProgress(null);
    }
  };

  const separator = parentDir.includes('\\') ? '\\' : '/';

  return (
    <div class="flex flex-col h-full" data-testid="screen-new-project">
      <TitleBar>New Project</TitleBar>
      <div class="flex flex-1 min-h-0">
        <SidebarMenu<string>
          items={[
            { id: PLAIN_TEXT, label: 'Plain Text', icon: <Badge text="T" /> },
            ...modules.newProject.map((n) => ({ id: n.language, label: n.languageName, icon: <ModuleIcon icon={n.icon} badge={n.badge} /> })),
          ]}
          selected={kind}
          onSelect={setKind}
          footer={<SidebarFooterButton label="＋ Add more…" onClick={() => window.saturn.windows.openMarketplace('languages')} />}
        />
        <main class="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {language?.tabs && language.tabs.length > 0 && (
            <>
              <TabMenu<string>
                tabs={language.tabs.map((t) => ({ id: t.id, label: t.label }))}
                active={tab ?? null}
                onSelect={(id) => {
                  setTab(id);
                  setTemplate(language.tabs!.find((t) => t.id === id)?.templates[0]?.id);
                }}
              />
              <div class="grid grid-cols-2 gap-2 p-4 pb-0" role="listbox" aria-label="Templates" data-testid="new-templates">
                {currentTab?.templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={t.id === template}
                    data-testid={`new-template-${t.id}`}
                    onClick={() => setTemplate(t.id)}
                    class={`flex items-start gap-2.5 p-2.5 text-left border ${t.id === template ? 'border-accent bg-selection' : 'border-border hover:bg-hover'}`}
                  >
                    {t.icon ? <ModuleIcon icon={t.icon} badge={t.label} class="size-6 shrink-0" /> : <Badge text={t.label.slice(0, 2)} class="size-6" />}
                    <span class="min-w-0">
                      <span class="block font-semibold text-strong">{t.label}</span>
                      {t.description && <span class="block text-muted text-[11px]">{t.description}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div class="p-4">
            <Heading>Project</Heading>
            <FormField label="Name">
              <TextInput value={name} onInput={setName} testId="new-name" />
            </FormField>
            <FormField label="Location">
              <div class="flex gap-2">
                <TextInput class="flex-1" value={parentDir} onInput={setParentDir} testId="new-location" />
                <Button onClick={() => void browse()}>Browse…</Button>
              </div>
            </FormField>
            <FormField label="Create Git repository">
              <Checkbox checked={gitInit} onChange={setGitInit} />
            </FormField>
            {language && shownFields.length > 0 && (
              <>
                <Heading class="mt-4">{language.languageName}</Heading>
                {shownFields.map((field) => (
                  <FormField key={field.id} label={field.label}>
                    <FieldInput field={field} value={fields[field.id] ?? ''} onChange={(v) => setFields({ ...fields, [field.id]: v })} />
                  </FormField>
                ))}
              </>
            )}
            <p class="text-muted mt-3">Will be created at {parentDir}{separator}{name.trim()}</p>
            {error && <p class="text-accent mt-2 whitespace-pre-wrap" role="alert">{error}</p>}
          </div>
        </main>
      </div>
      <DialogFooter>
        {busy && <span class="flex-1 truncate text-muted" data-testid="new-progress">{progress ?? 'Creating…'}</span>}
        <Button onClick={() => window.saturn.window.close()}>Cancel</Button>
        <Button variant="primary" testId="new-create" disabled={busy || (!!language?.tabs?.length && !template)} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </DialogFooter>
    </div>
  );
}
