import { useEffect, useState } from 'preact/hooks';
import type { GitCommit } from '@shared/types';
import { Badge } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { errorText, relativeTime, useGitStatus } from './gitState';

type Details = { message: string; files: { status: string; path: string }[] };

/** Git → history: the current branch's commits; selecting one shows its message and changed files. */
export function GitPanel() {
  const ws = useWorkspace();
  const [status] = useGitStatus();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Reload the history whenever the branch or its tip may have changed.
  const tip = `${status?.branch}|${status?.ahead}|${status?.behind}|${status?.changes.length}`;
  useEffect(() => {
    if (!status?.repo) return;
    void window.saturn.git.log().then(setCommits, (e) => setProblem(errorText(e)));
  }, [status?.repo, tip]);

  useEffect(() => {
    setDetails(null);
    if (selected) void window.saturn.git.show(selected).then(setDetails, (e) => setProblem(errorText(e)));
  }, [selected]);

  if (!status) return <p class="px-3 text-muted">Loading…</p>;
  if (!status.repo) return <p class="px-3 text-muted">This project isn't a Git repository.</p>;

  return (
    <div class="h-full flex min-h-0" data-testid="git-panel">
      <div class="flex-1 min-w-0 overflow-y-auto">
        {problem && <p class="px-3 text-accent" role="alert">{problem}</p>}
        {commits.length === 0 && !problem && <p class="px-3 text-muted">No commits yet.</p>}
        {commits.map((c) => (
          <button
            type="button"
            key={c.hash}
            data-testid="git-commit-row"
            onClick={() => setSelected(c.hash)}
            class={`w-full flex items-center gap-2 h-6 px-2.5 text-left ${c.hash === selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
          >
            <span class="font-mono text-muted shrink-0">{c.short}</span>
            <span class="flex-1 truncate">{c.subject}</span>
            {c.refs.map((r) => <Badge key={r} text={r.replace(/^HEAD -> /, '')} class="px-1" />)}
            <span class="text-muted shrink-0">{c.author} · {relativeTime(c.date)}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div class="w-80 shrink-0 border-l border-divider overflow-y-auto p-2.5" data-testid="git-commit-details">
          {!details ? <p class="m-0 text-muted">Loading…</p> : (
            <>
              <p class="m-0 mb-2 text-strong whitespace-pre-wrap select-text">{details.message}</p>
              {details.files.map((f) => (
                <button
                  type="button"
                  key={f.path}
                  class="w-full flex items-center gap-2 h-6 text-left hover:bg-hover px-1"
                  title={f.path}
                  onClick={() => void ws.documents.open(`${ws.projectPath}/${f.path}`)}
                >
                  <Badge text={f.status} />
                  <span class="truncate">{f.path}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
