import { useEffect, useState } from 'preact/hooks';
import type { GitStatus, GitTag } from '@shared/types';
import { ChevronDownIcon, ChevronRightIcon, TextInput } from '@renderer/components';
import { errorText } from './gitState';

type Kind = 'branch' | 'remote' | 'tag';

/** What a row is doing: renaming in place, asking to confirm a delete, or offering a forced delete. */
type Editing = { kind: Kind; name: string; mode: 'rename' | 'delete' | 'force' } | null;

interface GitRefsProps {
  status: GitStatus;
  /** The ref whose history is shown; null for the current branch. */
  selected: string | null;
  onSelect: (ref: string | null) => void;
}

/**
 * The Git panel's sidebar: local branches, remote branches and tags. Click one to see its history;
 * local branches can be checked out (double-click), renamed and deleted, and tags renamed and deleted.
 */
export function GitRefs({ status, selected, onSelect }: GitRefsProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [closed, setClosed] = useState<Set<Kind>>(new Set(['remote']));
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const tip = `${status.branch}|${status.ahead}|${status.behind}`;
  const load = () => {
    void window.saturn.git.branches().then(setBranches, () => setBranches([]));
    void window.saturn.git.remoteBranches().then(setRemotes, () => setRemotes([]));
    void window.saturn.git.tags().then(setTags, () => setTags([]));
  };
  useEffect(load, [tip]);
  useEffect(() => window.saturn.git.onChanged(load), []);

  const run = (task: Promise<void>, after?: () => void) => {
    setProblem(null);
    void task.then(() => {
      setEditing(null);
      after?.();
      load();
    }, (e) => {
      const text = errorText(e);
      // An unmerged branch can still be deleted on purpose.
      if (editing?.kind === 'branch' && /aren't merged/.test(text)) setEditing({ ...editing, mode: 'force' });
      else setProblem(text);
    });
  };
  const rename = (kind: Kind, from: string) => {
    if (!name.trim() || name.trim() === from) return setEditing(null);
    run(kind === 'tag' ? window.saturn.git.renameTag(from, name) : window.saturn.git.renameBranch(from, name), () => {
      if (selected === from) onSelect(name.trim());
    });
  };
  const remove = (kind: Kind, target: string, force = false) => run(
    kind === 'tag' ? window.saturn.git.deleteTag(target) : window.saturn.git.deleteBranch(target, force),
    () => selected === target && onSelect(null),
  );

  const section = (kind: Kind, title: string, count: number) => {
    const open = !closed.has(kind);
    return (
      <button
        type="button"
        class="w-full flex items-center gap-1.5 h-6 px-2 font-semibold text-strong hover:bg-hover"
        onClick={() => {
          const next = new Set(closed);
          if (open) next.add(kind);
          else next.delete(kind);
          setClosed(next);
        }}
      >
        {open ? <ChevronDownIcon class="size-3.5 text-muted" /> : <ChevronRightIcon class="size-3.5 text-muted" />}
        <span class="flex-1 text-left">{title}</span>
        <span class="text-muted font-normal">{count}</span>
      </button>
    );
  };

  const row = (kind: Kind, ref: string, label: string, detail?: string) => {
    const current = kind === 'branch' && ref === status.branch;
    const isSelected = selected === ref || (selected === null && current);
    const edit = editing?.kind === kind && editing.name === ref ? editing : null;
    if (edit?.mode === 'rename') {
      return (
        <div key={`${kind}:${ref}`} class="px-2 py-0.5 pl-7">
          <TextInput
            class="w-full"
            value={name}
            onInput={setName}
            testId="git-ref-rename"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename(kind, ref);
              if (e.key === 'Escape') setEditing(null);
            }}
            onBlur={() => setEditing(null)}
          />
        </div>
      );
    }
    if (edit) {
      return (
        <div key={`${kind}:${ref}`} class="flex items-center gap-2 h-6 pl-7 pr-2 bg-hover" data-testid="git-ref-confirm">
          <span class="flex-1 truncate">{edit.mode === 'force' ? `${label} has unmerged commits` : `Delete ${label}?`}</span>
          <button type="button" class="text-accent hover:text-strong" onClick={() => remove(kind, ref, edit.mode === 'force')}>
            {edit.mode === 'force' ? 'Delete anyway' : 'Delete'}
          </button>
          <button type="button" class="text-muted hover:text-strong" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      );
    }
    const editable = kind !== 'remote';
    return (
      <div
        key={`${kind}:${ref}`}
        role="treeitem"
        aria-selected={isSelected}
        class={`group flex items-center gap-2 h-6 pl-7 pr-2 cursor-pointer ${isSelected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
        title={kind === 'branch' && !current ? `${ref} (double-click to check out)` : ref}
        data-testid={`git-ref-${kind}`}
        onClick={() => onSelect(current ? null : ref)}
        onDblClick={() => kind === 'branch' && !current && run(window.saturn.git.checkout(ref), () => onSelect(null))}
      >
        <span class={`flex-1 truncate ${current ? 'font-semibold' : ''}`}>{label}</span>
        {detail && <span class="text-muted font-mono group-hover:hidden">{detail}</span>}
        {current && <span class="text-muted group-hover:hidden">current</span>}
        {editable && (
          <span class="hidden group-hover:flex gap-2 shrink-0">
            <button
              type="button"
              class="text-muted hover:text-strong"
              onClick={(e) => {
                e.stopPropagation();
                setName(ref);
                setEditing({ kind, name: ref, mode: 'rename' });
              }}
            >Rename</button>
            {!current && (
              <button
                type="button"
                class="text-muted hover:text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing({ kind, name: ref, mode: 'delete' });
                }}
              >Delete</button>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <div class="h-full overflow-y-auto py-1" role="tree" data-testid="git-refs">
      {problem && <p class="m-0 px-2 pb-1 text-accent break-words" role="alert">{problem}</p>}
      {section('branch', 'Branches', branches.length)}
      {!closed.has('branch') && branches.map((b) => row('branch', b, b))}
      {remotes.length > 0 && section('remote', 'Remote branches', remotes.length)}
      {!closed.has('remote') && remotes.map((b) => row('remote', b, b))}
      {section('tag', 'Tags', tags.length)}
      {!closed.has('tag') && (tags.length ? tags.map((t) => row('tag', t.name, t.name, t.commit)) : <p class="m-0 pl-7 text-muted">None.</p>)}
    </div>
  );
}
