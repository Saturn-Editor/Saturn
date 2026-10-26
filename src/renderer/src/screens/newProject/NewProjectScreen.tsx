import { useEffect, useState } from 'preact/hooks';
import type { ContributionSnapshot, NewProjectField } from '@shared/modules';
import {
  Badge, Button, Checkbox, DialogFooter, FormField, Heading, Select, SidebarFooterButton, SidebarNav, TextInput, TitleBar,
} from '@renderer/components';
import { EMPTY_SNAPSHOT } from '@renderer/modules/ModuleBridge';

const PLAIN_TEXT = 'plain-text';
type FieldValues = Record<string, string | boolean>;

function defaultsFor(fields: NewProjectField[]): FieldValues {
  return Object.fromEntries(fields.map((f) => [f.id, f.default ?? (f.type === 'checkbox' ? false : (f.options?.[0]?.value ?? ''))]));
}

/** One language-supplied field, drawn with Saturn's own components. */
function LanguageField({ field, value, onChange }: { field: NewProjectField; value: string | boolean; onChange: (v: string | boolean) => void }) {
  if (field.type === 'checkbox') return <Checkbox checked={value === true} onChange={onChange} />;
  if (field.type === 'select') {
    return <Select value={String(value)} options={field.options ?? []} onChange={onChange} />;
  }
  if (field.type === 'folder' || field.type === 'file') {
    return (
      <div class="flex gap-2">
        <TextInput class="flex-1" value={String(value)} onInput={onChange} />
        <Button onClick={() => void window.saturn.projects.pickFolder().then((p) => p && onChange(p))}>Browse…</Button>
      </div>
    );
  }
  return <TextInput value={String(value)} onInput={onChange} />;
}

export function NewProjectScreen() {
  const [modules, setModules] = useState<ContributionSnapshot>(EMPTY_SNAPSHOT);
  const [kind, setKind] = useState(PLAIN_TEXT);
  const [name, setName] = useState('untitled');
  const [parentDir, setParentDir] = useState('');
  const [gitInit, setGitInit] = useState(false);
  const [fields, setFields] = useState<FieldValues>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.saturn.projects.defaultParentDir().then(setParentDir);
    void window.saturn.modules.snapshot().then(setModules);
    return window.saturn.modules.onChanged(setModules);
  }, []);

  const language = modules.newProject.find((n) => n.language === kind);
  useEffect(() => setFields(defaultsFor(language?.fields ?? [])), [kind, language]);

  const browse = async () => {
    const picked = await window.saturn.projects.pickFolder();
    if (picked) setParentDir(picked);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.saturn.projects.create({ name, parentDir, gitInit, languageId: language?.language ?? null, fields });
    } catch (e) {
      // Electron prefixes IPC errors with "Error invoking remote method '…': Error: ".
      setError(String((e as Error).message).replace(/^.*Error: /, ''));
      setBusy(false);
    }
  };

  const separator = parentDir.includes('\\') ? '\\' : '/';

  return (
    <div class="flex flex-col h-full" data-testid="screen-new-project">
      <TitleBar>New Project</TitleBar>
      <div class="flex flex-1 min-h-0">
        <SidebarNav<string>
          items={[
            { id: PLAIN_TEXT, label: 'Plain Text', icon: <Badge text="T" /> },
            ...modules.newProject.map((n) => ({ id: n.language, label: n.languageName, icon: <Badge text={n.badge} /> })),
          ]}
          selected={kind}
          onSelect={setKind}
          footer={<SidebarFooterButton label="＋ Add more…" onClick={() => window.saturn.windows.openMarketplace('languages')} />}
        />
        <main class="flex-1 p-4 overflow-y-auto">
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
          {language && language.fields.length > 0 && (
            <>
              <Heading class="mt-4">{language.languageName}</Heading>
              {language.fields.map((field) => (
                <FormField key={field.id} label={field.label}>
                  <LanguageField field={field} value={fields[field.id] ?? ''} onChange={(v) => setFields({ ...fields, [field.id]: v })} />
                </FormField>
              ))}
            </>
          )}
          <p class="text-muted mt-3">Will be created at {parentDir}{separator}{name.trim()}</p>
          {error && <p class="text-accent mt-2" role="alert">{error}</p>}
        </main>
      </div>
      <DialogFooter>
        <Button onClick={() => window.saturn.window.close()}>Cancel</Button>
        <Button variant="primary" testId="new-create" disabled={busy} onClick={() => void create()}>Create</Button>
      </DialogFooter>
    </div>
  );
}
