import { useEffect, useState } from 'preact/hooks';
import type { GitCommit } from '@shared/types';
import { Badge, Button, ContextMenu, TabMenu, TextInput } from '@renderer/components';
import { HistoryPanel } from './HistoryPanel';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { relativeTime, useGitStatus } from './gitState';
import { errorText } from '@renderer/helpers';
import { GitRefs } from './GitRefs';
import { RebaseDialog } from './RebaseDialog';

type Details = { message: string; files: { status: string; path: string }[] };

/**
 * Git → history: branches and tags on the left (see GitRefs), and the chosen one's commits (the current
 * branch by default); selecting one shows its message and changed files, and
 * clicking a file shows its diff in that commit. Right-click a commit to cherry-pick, revert or tag it.
 */
export function GitPanel() {
  const ws = useWorkspace();
  const tab = ws.gitTab.value;
  return (
    <div class="h-full flex flex-col min-h-0">
      <TabMenu<'log' | 'history'>
        tabs={[{ id: 'log', label: 'Log' }, { id: 'history', label: 'File History' }]}
        active={tab}
        onSelect={(t) => (ws.gitTab.value = t)}
      />
      <div class="flex-1 min-h-0">{tab === 'log' ? <GitLog /> : <HistoryPanel />}</div>
    </div>
  );
}

function GitLog() {
  const ws = useWorkspace();
  const [status] = useGitStatus();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The branch or tag whose history is shown; null for the current branch. */
  const [ref, setRef] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ commit: GitCommit; at: { x: number; y: number } } | null>(null);
  const [tagging, setTagging] = useState<GitCommit | null>(null);
  const [rebasing, setRebasing] = useState<GitCommit | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const run = (task: Promise<void>, after?: () => void) => {
    setProblem(null);
    void task.then(after, (e) => setProblem(errorText(e)));
  };
  const pick = (id: string, commit: GitCommit) => {
    if (id === 'cherry-pick') run(window.saturn.git.cherryPick(commit.hash));
    if (id === 'revert') run(window.saturn.git.revert(commit.hash));
    if (id === 'copy') void navigator.clipboard.writeText(commit.hash);
    if (id === 'rebase') setRebasing(commit);
    if (id === 'tag') {
      setTagName('');
      setTagMessage('');
      setTagging(commit);
    }
  };

  // Reload the history whenever the branch or its tip may have changed.
  const tip = `${status?.branch}|${status?.ahead}|${status?.behind}|${status?.changes.length}`;
  useEffect(() => {
    if (!status?.repo) return;
    setProblem(null);
    void window.saturn.git.log(ref ?? undefined).then(setCommits, (e) => setProblem(errorText(e)));
  }, [status?.repo, tip, ref]);

  useEffect(() => {
    setDetails(null);
    if (selected) void window.saturn.git.show(selected).then(setDetails, (e) => setProblem(errorText(e)));
  }, [selected]);

  if (!status) return <p class="px-3 text-muted">Loading…</p>;
  if (!status.repo) return <p class="px-3 text-muted">This {ws.noun} isn't a Git repository.</p>;

  return (
    <div class="h-full flex min-h-0" data-testid="git-panel">
      <div class="w-56 shrink-0 border-r border-divider">
        <GitRefs status={status} selected={ref} onSelect={(r) => {
          setRef(r);
          setSelected(null);
        }} />
      </div>
      <div class="flex-1 min-w-0 overflow-y-auto">
        {problem && <p class="px-3 text-accent" role="alert">{problem}</p>}
        {commits.length === 0 && !problem && <p class="px-3 text-muted">No commits yet.</p>}
        {commits.map((c) => (
          <button
            type="button"
            key={c.hash}
            data-testid="git-commit-row"
            onClick={() => setSelected(c.hash)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ commit: c, at: { x: e.clientX, y: e.clientY } });
            }}
            class={`w-full flex items-center gap-2 h-6 px-2.5 text-left ${c.hash === selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
          >
            <span class="font-mono text-muted shrink-0">{c.short}</span>
            <span class="flex-1 truncate">{c.subject}</span>
            {c.refs.map((r) => <Badge key={r} text={r.replace(/^HEAD -> /, '')} class="px-1" />)}
            <span class="text-muted shrink-0">{c.author} · {relativeTime(c.date)}</span>
          </button>
        ))}
      </div>
      {menu && (
        <ContextMenu
          at={menu.at}
          items={[
            { id: 'cherry-pick', label: `Cherry-pick onto ${status.branch ?? 'HEAD'}`, testId: 'commit-cherry-pick' },
            { id: 'revert', label: 'Revert commit', testId: 'commit-revert' },
            { id: 'tag', label: 'New tag here…', testId: 'commit-tag' },
            ...(ref === null ? [{ id: 'rebase', label: 'Interactive rebase from here…', testId: 'commit-rebase' }] : []),
            { separator: true },
            { id: 'copy', label: 'Copy hash' },
          ]}
          onPick={(id) => pick(id, menu.commit)}
          onClose={() => setMenu(null)}
        />
      )}
      {rebasing && <RebaseDialog onto={rebasing} onClose={() => setRebasing(null)} />}
      {tagging && (
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/30" data-testid="git-tag-form">
          <div class="w-96 p-3 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-2">
            <div class="font-semibold text-strong">New tag on {tagging.short}</div>
            <TextInput value={tagName} onInput={setTagName} placeholder="Tag name, e.g. v1.0.0" testId="git-tag-name" autoFocus />
            <TextInput value={tagMessage} onInput={setTagMessage} placeholder="Message (optional; makes an annotated tag)" testId="git-tag-message" />
            {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
            <div class="flex justify-end gap-2">
              <Button onClick={() => setTagging(null)}>Cancel</Button>
              <Button variant="primary" testId="git-tag-create" onClick={() => run(window.saturn.git.createTag(tagName, tagging.hash, tagMessage), () => setTagging(null))}>Create tag</Button>
            </div>
          </div>
        </div>
      )}
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
                  onClick={() => void window.saturn.git.diff(f.path, selected).then(
                    (diff) => ws.documents.openDiff(`${selected}:${f.path}`, `${f.path.split('/').pop()} (${selected.slice(0, 7)})`, { diff }),
                    (e) => setProblem(errorText(e)),
                  )}
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
