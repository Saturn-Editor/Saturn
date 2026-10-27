import { useEffect, useState } from 'preact/hooks';
import { FILE_ENCODINGS, type FileEncoding } from '@shared/types';
import { diagnosticCounts, onDiagnosticCounts } from '@renderer/modules/languageServer';
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
        <span class="whitespace-nowrap" data-testid="status-file">
          {language} · {encodingLabel} · {doc.eol} · {ws.cursor.value}
        </span>
      )}
    </footer>
  );
}
