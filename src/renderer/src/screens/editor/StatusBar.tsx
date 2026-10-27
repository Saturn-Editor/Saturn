import { useEffect, useRef, useState } from 'preact/hooks';
import { FILE_ENCODINGS, type FileEncoding } from '@shared/types';
import { ContextMenu, type MenuEntry } from '@renderer/components';
import { diagnosticCounts, onDiagnosticCounts } from '@renderer/modules/languageServer';
import { languageCandidates, PLAIN_TEXT_LANGUAGE } from '@renderer/modules/ModuleBridge';
import { useWorkspace } from './EditorWorkspace';

export function StatusBar() {
  const ws = useWorkspace();
  const doc = ws.documents.active.value;
  const relative = doc ? doc.path.slice(ws.projectPath.length).replace(/^[\\/]/, '') : '';
  const crumbs = [ws.projectName, ...relative.split(/[\\/]/).filter(Boolean)].join(' › ');
  ws.modules.snapshot.value; // re-render when languages change
  const language = doc ? (ws.modules.languageFor(doc.path)?.name ?? 'Plain Text') : null;
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
      {doc && (
        <span class="whitespace-nowrap flex items-center gap-1" data-testid="status-file">
          <LanguageMenu path={doc.path} label={language ?? 'Plain Text'} />
          · {encodingLabel} · {doc.eol} · {ws.cursor.value}
        </span>
      )}
    </footer>
  );
}

/**
 * The file's language in the status bar; clicking it picks another for this file, and (when several
 * installed languages claim its extension) which one opens every file with that extension.
 */
function LanguageMenu({ path, label }: { path: string; label: string }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const snapshot = ws.modules.snapshot.value;
  const candidates = languageCandidates(snapshot, path);
  const extension = candidates[0]?.extension;
  const picked = ws.modules.fileLanguages.value[path];
  const items: MenuEntry[] = [
    { group: 'This file' },
    { id: `file:${PLAIN_TEXT_LANGUAGE}`, label: 'Plain Text', testId: 'language-plain' },
    ...snapshot.languages.map((l) => ({ id: `file:${l.id}`, label: l.name, testId: `language-${l.id}` })),
    ...(picked ? [{ id: 'file:auto', label: 'By file extension', hint: 'Undo the choice above' }] : []),
    ...(candidates.length > 1 && extension ? [
      { separator: true } as const,
      { group: `All ${extension} files` } as const,
      ...candidates.map((c) => ({
        id: `ext:${c.language.id}`,
        label: c.language.name,
        hint: ws.modules.extensionLanguages.value[extension] === c.language.id ? 'current' : undefined,
        testId: `language-ext-${c.language.id}`,
      })),
    ] : []),
  ];
  const pick = (id: string) => {
    const [scope, languageId] = id.split(':');
    if (scope === 'file') void window.saturn.languages.setFileLanguage(path, languageId === 'auto' ? null : languageId);
    else if (extension) void window.saturn.settings.update({ extensionLanguages: { ...ws.modules.extensionLanguages.value, [extension]: languageId } });
  };
  return (
    <span ref={anchor} class="relative">
      <button type="button" class="hover:text-strong" title="Change the file's language" data-testid="status-language" onClick={() => setOpen(!open)}>
        {label}{candidates.length > 1 && !picked ? ' ▾' : ''}
      </button>
      {open && <ContextMenu class="bottom-6 right-0 w-60 max-h-80 overflow-y-auto" anchor={anchor} items={items} onPick={pick} onClose={() => setOpen(false)} />}
    </span>
  );
}
