import { useEffect, useState } from 'preact/hooks';
import type { GitCommit } from '@shared/types';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { baseName, errorText } from '@renderer/helpers';
import { relativeTime } from './gitState';

export function HistoryPanel() {
  const ws = useWorkspace();
  const active = ws.documents.activePath.value;
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (active && (active.startsWith(`${ws.projectPath}/`) || active.startsWith(`${ws.projectPath}\\`))) setPath(active);
  }, [active]);
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const relative = path ? path.slice(ws.projectPath.length + 1) : null;

  useEffect(() => {
    setCommits(null);
    setSelected(null);
    setProblem(null);
    if (relative) void window.saturn.git.fileLog(relative).then(setCommits, (e) => setProblem(errorText(e)));
  }, [relative]);

  if (!path || !relative) return <p class="px-3 text-muted">Open a file to see its history.</p>;
  return (
    <div class="h-full overflow-y-auto py-1" data-testid="history-panel">
      <div class="px-2.5 pb-1 text-muted truncate">{relative}</div>
      {problem && <p class="px-3 text-accent" role="alert">{problem}</p>}
      {commits === null && !problem && <p class="px-3 text-muted">Loading…</p>}
      {commits?.length === 0 && <p class="px-3 text-muted">No commits touch this file yet.</p>}
      {commits?.map((c) => (
        <button
          type="button"
          key={c.hash}
          data-testid="history-commit"
          onClick={() => {
            setSelected(c.hash);
            void ws.showCommitDiff(relative, c.hash).catch((e) => setProblem(errorText(e)));
          }}
          class={`w-full flex items-center gap-2 h-6 px-2.5 text-left ${c.hash === selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
          title={`${c.subject}\n${baseName(relative)} in ${c.short}`}
        >
          <span class="font-mono text-muted shrink-0">{c.short}</span>
          <span class="flex-1 truncate">{c.subject}</span>
          <span class="text-muted shrink-0">{c.author} · {relativeTime(c.date)}</span>
        </button>
      ))}
    </div>
  );
}
