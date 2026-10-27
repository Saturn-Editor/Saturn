import { useWorkspace } from './EditorWorkspace';

export function StatusBar() {
  const ws = useWorkspace();
  const doc = ws.documents.active.value;
  const relative = doc ? doc.path.slice(ws.projectPath.length).replace(/^[\\/]/, '') : '';
  const crumbs = [ws.projectName, ...relative.split(/[\\/]/).filter(Boolean)].join(' › ');
  ws.modules.snapshot.value; // re-render when languages change
  const language = doc ? (ws.modules.languageFor(doc.path)?.name ?? 'Plain Text') : null;
  const notice = ws.notice.value;

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
      {doc && (
        <span class="whitespace-nowrap" data-testid="status-file">
          {language} · UTF-8 · {doc.eol} · {ws.cursor.value}
        </span>
      )}
    </footer>
  );
}
