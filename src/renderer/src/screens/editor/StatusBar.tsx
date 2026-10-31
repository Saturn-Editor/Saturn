import { useEffect, useRef, useState } from 'preact/hooks';
import { FILE_ENCODINGS, type FileEncoding } from '@shared/types';
import { documentFor, type LanguageVersion as LanguageVersionType, type LanguageVersionChoices } from '@shared/modules';
import { ContextMenu, type MenuEntry } from '@renderer/components';
import { diagnosticCounts, onDiagnosticCounts } from '@renderer/modules/languageServer';
import { errorText } from '@renderer/helpers';
import { useWorkspace } from './EditorWorkspace';

export function StatusBar() {
  const ws = useWorkspace();
  const doc = ws.documents.active.value;
  const relative = doc ? doc.path.slice(ws.projectPath.length).replace(/^[\\/]/, '') : '';
  const crumbs = [ws.projectName, ...relative.split(/[\\/]/).filter(Boolean)].join(' › ');
  ws.modules.snapshot.value; // re-render when languages change
  const notice = ws.notice.value;
  // Settings → Editor → Behaviour → Encoding, kept current.
  const [encoding, setEncoding] = useState<FileEncoding>('utf-8');
  useEffect(() => {
    void window.saturn.settings.get().then((s) => setEncoding(s.encoding));
    return window.saturn.settings.onChanged((s) => setEncoding(s.encoding));
  }, []);
  const encodingLabel = FILE_ENCODINGS.find((e) => e.id === encoding)?.label ?? 'UTF-8';
  // Errors and warnings for the open file, from its language server.
  const [, setCountsVersion] = useState(0);
  useEffect(() => onDiagnosticCounts(() => setCountsVersion((n) => n + 1)), []);
  const counts = doc ? diagnosticCounts(doc.path) : { errors: 0, warnings: 0 };

  return (
    <footer class="flex items-center gap-3 h-6 px-2.5 bg-panel border-t border-divider text-muted shrink-0" data-testid="status-bar">
      <span class="truncate flex-1">{crumbs}</span>
      {notice && (
        <button
          type="button"
          data-testid="status-notice"
          class={`truncate max-w-[50%] ${notice.kind === 'info' ? 'text-strong' : 'text-accent'}`}
          title={`${notice.text} (click to dismiss)`}
          onClick={() => (ws.notice.value = null)}
        >
          {notice.kind === 'error' ? 'Error: ' : notice.kind === 'warning' ? 'Warning: ' : ''}{notice.text}
        </button>
      )}
      {(counts.errors > 0 || counts.warnings > 0) && (
        <span class="whitespace-nowrap" data-testid="status-problems" title="Errors and warnings in this file">
          <span class={counts.errors ? 'text-accent' : ''}>{counts.errors} error{counts.errors === 1 ? '' : 's'}</span>
          {' · '}
          {counts.warnings} warning{counts.warnings === 1 ? '' : 's'}
        </span>
      )}
      {doc && (doc.asText || !documentFor(ws.modules.snapshot.value, doc.path)) && (
        <span class="whitespace-nowrap flex items-center gap-1" data-testid="status-file">
          <LanguageVersion path={doc.path} />
          · {encodingLabel} · {doc.eol} · {ws.cursor.value}
        </span>
      )}
    </footer>
  );
}

const ADD = '\0add';

function LanguageVersion({ path }: { path: string }) {
  const ws = useWorkspace();
  const language = ws.modules.languageFor(path);
  const [versions, setVersions] = useState<Record<string, LanguageVersionType>>({});
  const [choices, setChoices] = useState<LanguageVersionChoices | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    void window.saturn.languages.versions().then(setVersions);
    return window.saturn.languages.onVersionsChanged(setVersions);
  }, []);

  if (!language) return <span data-testid="status-language">Plain Text</span>;
  const current = versions[language.id];
  const label = current ? `${language.name} ${current.label}` : language.name;
  if (!language.versions) return <span data-testid="status-language">{label}</span>;

  const items: MenuEntry[] = choices ? [
    { group: `${language.name} version` },
    ...choices.items.map((v) => ({ id: v.id, label: v.label, hint: v.detail, testId: `language-version-${v.id}` })),
    ...(choices.items.length === 0 ? [{ group: 'None found' } as const] : []),
    ...(choices.addLabel ? [{ separator: true } as const, { id: ADD, label: choices.addLabel, testId: 'language-version-add' }] : []),
  ] : [];
  const pick = (id: string) => {
    if (!choices) return;
    const report = (e: unknown) => (ws.notice.value = { text: errorText(e), kind: 'error' });
    if (id === ADD) void window.saturn.languages.addVersion(language.id, choices.addLabel ?? 'Add').catch(report);
    else {
      const version = choices.items.find((v) => v.id === id);
      if (version) void window.saturn.languages.setVersion(language.id, version).catch(report);
    }
  };
  return (
    <span ref={anchor} class="relative">
      <button
        type="button"
        class="hover:text-strong"
        title={`Choose the ${language.name} version for this project`}
        data-testid="status-language"
        onClick={() => {
          if (choices) return setChoices(null);
          void window.saturn.languages.versionChoices(language.id).then(setChoices, (e) => (ws.notice.value = { text: errorText(e), kind: 'error' }));
        }}
      >
        {label}
      </button>
      {choices && <ContextMenu class="bottom-6 right-0 w-72 max-h-80 overflow-y-auto" anchor={anchor} items={items} onPick={pick} onClose={() => setChoices(null)} />}
    </span>
  );
}
