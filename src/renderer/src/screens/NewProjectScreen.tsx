import { useEffect, useState } from 'preact/hooks';
import { fieldApplies, settingDefaults, type ContributionSnapshot, type SettingValues } from '@shared/modules';
import {
  Badge, Button, Checkbox, DialogFooter, FieldInput, ModuleIcon, FormField, Heading, Select, SidebarFooterButton, SidebarMenu, TabMenu, TextInput, TitleBar,
} from '@renderer/components';
import { EMPTY_SNAPSHOT } from '@renderer/modules/ModuleBridge';
import { CloneForm } from './WelcomeScreen';

const PLAIN_TEXT = 'plain-text';

/**
 * New Project: Plain Text or an installed language in the sidebar. A language can offer templates in
 * tabs along the top (e.g. C#: Empty solution, .NET, Web, MAUI), each tab a Template dropdown with the
 * chosen template's description under it, and fields that apply only to some of
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
  const currentTemplate = currentTab?.templates.find((t) => t.id === template);
  const choice = { tab, template };
  const shownFields = (language?.fields ?? []).filter((f) => fieldApplies(f, choice));

  const browse = async () => {
    const picked = await window.saturn.projects.pickFolder();
    if (picked) setParentDir(picked);
  };

  // Opened from an editor: Create first asks whether to open the project in that window or a new one.
  const opener = window.saturn.window.projectPath;
  const openerName = opener?.split(/[\\/]/).pop();
  const [choosing, setChoosing] = useState(false);
  const [cloning, setCloning] = useState(false);
  // Opening or cloning instead of creating: the project opens in its own window and this one closes.
  const openExisting = async () => {
    if (await window.saturn.projects.openDialog()) window.saturn.window.close();
  };

  const create = async (replace = false) => {
    setChoosing(false);
    setBusy(true);
    setError(null);
    setProgress(null);
    // Only the fields that apply to the chosen template are sent, plus the tab and template.
    const sent: SettingValues = Object.fromEntries(shownFields.map((f) => [f.id, fields[f.id] ?? '']));
    if (tab) sent.tab = tab;
    if (template) sent.template = template;
    try {
      await window.saturn.projects.create({
        name, parentDir, gitInit, languageId: language?.language ?? null, fields: sent, ...(replace && opener && { replaceProject: opener }),
      });
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
              <div class="p-4 pb-0" data-testid="new-template">
                <FormField label="Template">
                  <Select value={template ?? ''} options={(currentTab?.templates ?? []).map((t) => ({ value: t.id, label: t.label }))} onChange={setTemplate} />
                </FormField>
                {currentTemplate?.description && <p class="-mt-1.5 mb-0 ml-[152px] text-muted text-[11px]">{currentTemplate.description}</p>}
              </div>
            </>
          )}
          <div class="p-4">
            {cloning && <CloneForm onCancel={() => setCloning(false)} onCloned={() => window.saturn.window.close()} />}
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
        <Button testId="new-open" disabled={busy} onClick={() => void openExisting()}>Open…</Button>
        <Button testId="new-clone" disabled={busy} onClick={() => setCloning(!cloning)}>Clone…</Button>
        {busy ? <span class="flex-1 truncate text-muted" data-testid="new-progress">{progress ?? 'Creating…'}</span> : <span class="flex-1" />}
        <Button onClick={() => window.saturn.window.close()}>Cancel</Button>
        <Button
          variant="primary"
          testId="new-create"
          disabled={busy || (!!language?.tabs?.length && !template)}
          onClick={() => (opener ? setChoosing(true) : void create())}
        >
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </DialogFooter>
      {choosing && (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40" data-testid="new-open-choice" onKeyDown={(e) => e.key === 'Escape' && setChoosing(false)}>
          <div class="w-96 p-4 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-3">
            <div class="font-semibold text-strong">Open {name.trim() || 'the new project'}</div>
            <p class="m-0 text-muted">In this window closes {openerName}.</p>
            <div class="flex justify-end gap-2">
              <Button onClick={() => setChoosing(false)}>Cancel</Button>
              <Button testId="new-open-new-window" onClick={() => void create(false)}>New window</Button>
              <Button variant="primary" testId="new-open-here" onClick={() => void create(true)}>This window</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
