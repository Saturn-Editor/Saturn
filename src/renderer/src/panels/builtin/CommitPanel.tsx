import { useState } from 'preact/hooks';
import type { GitChange } from '@shared/types';
import { Badge, Button, Checkbox, ChevronDownIcon, ChevronRightIcon, TextArea } from '@renderer/components';
import { isMac } from '@renderer/commands/keymap';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { errorText, useGitStatus } from './gitState';

type Staging = 'all' | 'some' | 'none';

/** How much of a change is staged: all of it, some (staged, then edited again) or none (including untracked). */
function stagingOf(c: GitChange): Staging {
  const staged = c.index !== ' ' && c.index !== '?';
  if (!staged) return 'none';
  return c.worktree === ' ' ? 'all' : 'some';
}

/** The letter for a change: the working-tree change if any, else the staged one ("?" untracked shows as "U"). */
function letter(c: GitChange): string {
  const code = c.worktree !== ' ' ? c.worktree : c.index;
  return code === '?' ? 'U' : code;
}

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  files: GitChange[];
}

function buildTree(changes: GitChange[]): Folder {
  const root: Folder = { name: '', path: '', folders: new Map(), files: [] };
  for (const c of changes) {
    const parts = c.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path, folders: new Map(), files: [] });
      node = node.folders.get(part)!;
    }
    node.files.push(c);
  }
  return root;
}

function filesUnder(folder: Folder): GitChange[] {
  return [...folder.files, ...[...folder.folders.values()].flatMap(filesUnder)];
}

/** A folder is ticked when everything in it is fully staged, empty when nothing is, and half-ticked otherwise. */
function stagingOfAll(changes: GitChange[]): Staging {
  const states = changes.map(stagingOf);
  if (states.every((s) => s === 'all')) return 'all';
  return states.every((s) => s === 'none') ? 'none' : 'some';
}

/**
 * Git → Commit: every change in one file tree. A ticked box means staged; ticking a folder stages
 * everything in it. Then write a message and commit, or push and pull the current branch.
 */
export function CommitPanel() {
  const ws = useWorkspace();
  const [status] = useGitStatus();
  const [message, setMessage] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const act = async (label: string, run: () => Promise<void>) => {
    setBusy(label);
    setProblem(null);
    try {
      await run();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <p class="px-3 text-muted">Loading…</p>;
  if (!status.repo) {
    return (
      <div class="p-3 flex flex-col items-start gap-2">
        <p class="m-0 text-muted">This project isn't a Git repository.</p>
        <Button testId="git-init" onClick={() => void act('init', () => window.saturn.git.init())}>Create repository</Button>
        {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
      </div>
    );
  }

  const stagedCount = status.changes.filter((c) => stagingOf(c) !== 'none').length;
  /** Fully staged → unstage; otherwise stage the lot. */
  const toggle = (changes: GitChange[]) => {
    const paths = changes.map((c) => c.path);
    void act('stage', () => (stagingOfAll(changes) === 'all' ? window.saturn.git.unstage(paths) : window.saturn.git.stage(paths)));
  };
  const commit = () => void act('commit', async () => {
    await window.saturn.git.commit(message);
    setMessage('');
  });
  const canCommit = stagedCount > 0 && message.trim() !== '' && !busy;

  const rows: preact.ComponentChildren[] = [];
  const walk = (folder: Folder, depth: number) => {
    for (const sub of [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const files = filesUnder(sub);
      const state = stagingOfAll(files);
      const open = !collapsed.has(sub.path);
      rows.push(
        <div key={`d:${sub.path}`} class="flex items-center gap-1.5 h-6 pr-2 hover:bg-hover" style={{ paddingLeft: `${8 + depth * 14}px` }} data-testid="git-folder">
          <button
            type="button"
            class="size-3.5 shrink-0 text-muted"
            aria-label={open ? `Collapse ${sub.name}` : `Expand ${sub.name}`}
            onClick={() => {
              const next = new Set(collapsed);
              if (open) next.add(sub.path);
              else next.delete(sub.path);
              setCollapsed(next);
            }}
          >
            {open ? <ChevronDownIcon class="size-3.5" /> : <ChevronRightIcon class="size-3.5" />}
          </button>
          <Checkbox checked={state === 'all'} indeterminate={state === 'some'} onChange={() => toggle(files)} testId={`git-toggle-${sub.path}/`} />
          <span class="flex-1 truncate text-strong">{sub.name}</span>
          <span class="text-muted">{files.length}</span>
        </div>,
      );
      if (open) walk(sub, depth + 1);
    }
    for (const c of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) {
      const state = stagingOf(c);
      rows.push(
        <div key={`f:${c.path}`} class="flex items-center gap-1.5 h-6 pr-2 hover:bg-hover" style={{ paddingLeft: `${8 + depth * 14 + 18}px` }} data-testid="git-change">
          <Checkbox checked={state === 'all'} indeterminate={state === 'some'} onChange={() => toggle([c])} testId={`git-toggle-${c.path}`} />
          <button type="button" class="flex-1 min-w-0 text-left truncate" title={c.path} onClick={() => void ws.documents.open(`${ws.projectPath}/${c.path}`)}>
            {c.path.split('/').pop()}
          </button>
          <Badge text={letter(c)} />
        </div>,
      );
    }
  };
  walk(buildTree(status.changes), 0);
  const allState = stagingOfAll(status.changes);

  return (
    <div class="h-full flex flex-col" data-testid="commit-panel">
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-divider">
        <span class="flex-1 truncate text-strong" title={status.upstream ?? 'No upstream branch'}>
          {status.branch ?? 'Detached HEAD'}
          {(status.ahead > 0 || status.behind > 0) && <span class="text-muted font-normal"> ↑{status.ahead} ↓{status.behind}</span>}
        </span>
        <Button testId="git-pull" disabled={!!busy} onClick={() => void act('pull', () => window.saturn.git.pull())}>{busy === 'pull' ? 'Pulling…' : 'Pull'}</Button>
        <Button testId="git-push" disabled={!!busy} onClick={() => void act('push', () => window.saturn.git.push())}>{busy === 'push' ? 'Pushing…' : 'Push'}</Button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto py-1">
        {status.changes.length === 0 ? <p class="m-0 px-2 py-1 text-muted">No changes.</p> : (
          <>
            <div class="flex items-center gap-1.5 h-6 px-2 font-semibold text-strong">
              <Checkbox checked={allState === 'all'} indeterminate={allState === 'some'} onChange={() => toggle(status.changes)} testId="git-toggle-all" />
              <span class="flex-1">Changes</span>
              <span class="text-muted font-normal">{stagedCount} of {status.changes.length} staged</span>
            </div>
            {rows}
          </>
        )}
      </div>
      <div class="flex flex-col gap-1.5 p-2 border-t border-divider">
        {problem && <p class="m-0 text-accent break-words" role="alert">{problem}</p>}
        <TextArea
          value={message}
          onInput={setMessage}
          placeholder={`Commit message (${isMac ? '⌘' : 'Ctrl+'}Enter to commit)`}
          testId="git-message"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey) && canCommit) {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button variant="primary" testId="git-commit" disabled={!canCommit} onClick={commit}>
          {busy === 'commit' ? 'Committing…' : `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
