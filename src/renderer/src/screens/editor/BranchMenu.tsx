import { useEffect, useRef, useState } from 'preact/hooks';
import type { GitRemote, GitTag } from '@shared/types';
import { Button, ChevronDownIcon, Checkbox, ContextMenu, GitIcon, Select, TextInput, type MenuEntry } from '@renderer/components';
import { errorText, useGitStatus } from '@renderer/panels/builtin/gitState';

const NEW_BRANCH = '\0new';
const MERGE = '\0merge';
const DELETE = '\0delete';
const REMOTES = '\0remotes';
const REBASE = '\0rebase';
const TAGS = '\0tags';

type Form = 'create' | 'merge' | 'rebase' | 'delete' | 'remotes' | 'tags' | null;

/** A small panel under the branch menu (New branch, Merge, Delete, Remotes). */
function FormBox({ title, testId, children }: { title: string; testId: string; children: preact.ComponentChildren }) {
  return (
    <div class="absolute z-20 top-7 left-0 w-80 p-2.5 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-2" data-testid={testId}>
      <div class="font-semibold text-strong">{title}</div>
      {children}
    </div>
  );
}

/** The repository's tags, newest first: delete one, push them all, or tag the current commit. */
function TagsForm({ onClose }: { onClose: () => void }) {
  const [tags, setTags] = useState<GitTag[]>([]);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () => void window.saturn.git.tags().then(setTags, (e) => setProblem(errorText(e)));
  useEffect(load, []);
  const run = (task: Promise<void>, after?: () => void) => void task.then(() => {
    setProblem(null);
    after?.();
    load();
  }, (e) => setProblem(errorText(e)));
  return (
    <FormBox title="Tags" testId="git-tags-form">
      <div class="max-h-48 overflow-y-auto flex flex-col gap-1">
        {tags.length === 0 && <p class="m-0 text-muted">None.</p>}
        {tags.map((t) => (
          <div key={t.name} class="flex items-center gap-2" title={t.message || undefined}>
            <span class="text-strong">{t.name}</span>
            <span class="flex-1 truncate text-muted font-mono">{t.commit}</span>
            <button type="button" class="text-muted hover:text-accent" onClick={() => run(window.saturn.git.deleteTag(t.name))}>Delete</button>
          </div>
        ))}
      </div>
      <div class="flex gap-2">
        <TextInput class="flex-1 min-w-0" value={name} onInput={setName} placeholder="New tag on the current commit" testId="git-tags-name" />
        <Button testId="git-tags-add" onClick={() => run(window.saturn.git.createTag(name), () => setName(''))}>Add</Button>
      </div>
      {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
      {note && <p class="m-0 text-muted">{note}</p>}
      <div class="flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" testId="git-tags-push" disabled={tags.length === 0} onClick={() => run(window.saturn.git.pushTags(), () => setNote('Tags pushed.'))}>Push tags</Button>
      </div>
    </FormBox>
  );
}

/** Lists the repository's remotes, with Remove, and adds new ones. */
function RemotesForm({ onClose }: { onClose: () => void }) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const load = () => void window.saturn.git.remotes().then(setRemotes, (e) => setProblem(errorText(e)));
  useEffect(load, []);
  const run = (task: Promise<void>, after?: () => void) => void task.then(() => {
    setProblem(null);
    after?.();
    load();
  }, (e) => setProblem(errorText(e)));
  return (
    <FormBox title="Remotes" testId="git-remotes-form">
      {remotes.length === 0 && <p class="m-0 text-muted">None.</p>}
      {remotes.map((r) => (
        <div key={r.name} class="flex items-center gap-2">
          <span class="text-strong">{r.name}</span>
          <span class="flex-1 truncate text-muted" title={r.url}>{r.url}</span>
          <button type="button" class="text-muted hover:text-accent" onClick={() => run(window.saturn.git.removeRemote(r.name))}>Remove</button>
        </div>
      ))}
      <div class="flex gap-2">
        <TextInput class="w-24" value={name} onInput={setName} placeholder="Name" testId="git-remote-name" />
        <TextInput class="flex-1 min-w-0" value={url} onInput={setUrl} placeholder="URL" testId="git-remote-url" />
      </div>
      {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
      <div class="flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" testId="git-remote-add" onClick={() => run(window.saturn.git.addRemote(name, url), () => {
          setName('');
          setUrl('');
        })}>Add remote</Button>
      </div>
    </FormBox>
  );
}

/**
 * The current Git branch in the top bar; its menu switches branches, creates, merges and deletes them,
 * and manages remotes. Hidden outside a repository.
 */
export function BranchMenu() {
  const [status] = useGitStatus();
  const [branches, setBranches] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<Form>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [force, setForce] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!status?.repo) return null;

  const openMenu = () => {
    setProblem(null);
    void window.saturn.git.branches().then(setBranches, (e) => setProblem(errorText(e)));
    setMenuOpen(!menuOpen);
  };

  const others = branches.filter((b) => b !== status.branch);
  const pick = (id: string) => {
    setProblem(null);
    if (id === NEW_BRANCH) {
      setName('');
      setForm('create');
      return;
    }
    if (id === MERGE || id === DELETE || id === REBASE) {
      setTarget(others[0] ?? '');
      setForce(false);
      setForm(id === MERGE ? 'merge' : id === REBASE ? 'rebase' : 'delete');
      return;
    }
    if (id === REMOTES) return setForm('remotes');
    if (id === TAGS) return setForm('tags');
    if (id !== status.branch) void window.saturn.git.checkout(id).catch((e) => setProblem(errorText(e)));
  };

  const done = (task: Promise<void>) => void task.then(() => setForm(null), (e) => setProblem(errorText(e)));
  const create = () => done(window.saturn.git.createBranch(name));
  const branchSelect = <Select value={target} options={others.map((b) => ({ value: b, label: b }))} onChange={setTarget} />;

  const items: MenuEntry[] = [
    { group: 'Branches' },
    ...branches.map((b) => ({ id: b, label: b, hint: b === status.branch ? 'current' : undefined, testId: `branch-${b}` })),
    { separator: true },
    { id: NEW_BRANCH, label: 'New branch…', testId: 'branch-new' },
    ...(others.length ? [
      { id: MERGE, label: `Merge into ${status.branch ?? 'HEAD'}…`, testId: 'branch-merge' },
      { id: REBASE, label: `Rebase ${status.branch ?? 'HEAD'} onto…`, testId: 'branch-rebase' },
      { id: DELETE, label: 'Delete branch…', testId: 'branch-delete' },
    ] : []),
    { separator: true },
    { id: TAGS, label: 'Tags…', testId: 'branch-tags' },
    { id: REMOTES, label: 'Remotes…', testId: 'branch-remotes' },
  ];

  return (
    <div class="relative flex items-center min-w-0">
      <button
        ref={anchor}
        type="button"
        data-testid="branch-menu"
        title={problem ?? 'Switch or create a branch'}
        onClick={openMenu}
        class={`h-6 px-1.5 flex items-center gap-1 min-w-0 hover:bg-hover ${problem ? 'text-accent' : 'text-muted hover:text-strong'}`}
      >
        <GitIcon class="size-3.5 shrink-0" />
        <span class="truncate">{status.branch ?? 'Detached HEAD'}</span>
        <ChevronDownIcon class="size-3 shrink-0" />
      </button>
      {menuOpen && <ContextMenu class="top-7 left-0 w-60" anchor={anchor} items={items} onPick={pick} onClose={() => setMenuOpen(false)} />}
      {form === 'create' && (
        <FormBox title={`New branch from ${status.branch ?? 'HEAD'}`} testId="branch-new-form">
          <TextInput
            value={name}
            onInput={setName}
            placeholder="Branch name"
            testId="branch-new-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
              if (e.key === 'Escape') setForm(null);
            }}
          />
          {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
          <div class="flex justify-end gap-2">
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" testId="branch-create" onClick={create}>Create and switch</Button>
          </div>
        </FormBox>
      )}
      {form === 'merge' && (
        <FormBox title={`Merge into ${status.branch ?? 'HEAD'}`} testId="branch-merge-form">
          {branchSelect}
          {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
          <div class="flex justify-end gap-2">
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" testId="branch-merge-go" disabled={!target} onClick={() => done(window.saturn.git.merge(target))}>Merge</Button>
          </div>
        </FormBox>
      )}
      {form === 'delete' && (
        <FormBox title="Delete branch" testId="branch-delete-form">
          {branchSelect}
          <label class="flex items-center gap-2">
            <Checkbox checked={force} onChange={() => setForce(!force)} />
            <span>Delete even if it has unmerged commits</span>
          </label>
          {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
          <div class="flex justify-end gap-2">
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" testId="branch-delete-go" disabled={!target} onClick={() => done(window.saturn.git.deleteBranch(target, force))}>Delete</Button>
          </div>
        </FormBox>
      )}
      {form === 'rebase' && (
        <FormBox title={`Rebase ${status.branch ?? 'HEAD'} onto`} testId="branch-rebase-form">
          {branchSelect}
          <p class="m-0 text-muted">Replays this branch's own commits on top of the chosen branch. Its history is rewritten, so avoid it on branches others have pulled.</p>
          {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
          <div class="flex justify-end gap-2">
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" testId="branch-rebase-go" disabled={!target} onClick={() => done(window.saturn.git.rebase(target))}>Rebase</Button>
          </div>
        </FormBox>
      )}
      {form === 'remotes' && <RemotesForm onClose={() => setForm(null)} />}
      {form === 'tags' && <TagsForm onClose={() => setForm(null)} />}
    </div>
  );
}
