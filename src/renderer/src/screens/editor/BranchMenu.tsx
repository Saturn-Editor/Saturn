import { useRef, useState } from 'preact/hooks';
import { Button, ChevronDownIcon, ContextMenu, GitIcon, TextInput, type MenuEntry } from '@renderer/components';
import { errorText, useGitStatus } from '@renderer/panels/builtin/gitState';

const NEW_BRANCH = '\0new';

/** The current Git branch in the top bar; its menu switches branches or creates one. Hidden outside a repository. */
export function BranchMenu() {
  const [status] = useGitStatus();
  const [branches, setBranches] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!status?.repo) return null;

  const openMenu = () => {
    setProblem(null);
    void window.saturn.git.branches().then(setBranches, (e) => setProblem(errorText(e)));
    setMenuOpen(!menuOpen);
  };

  const pick = (id: string) => {
    if (id === NEW_BRANCH) {
      setName('');
      setCreating(true);
      return;
    }
    if (id !== status.branch) void window.saturn.git.checkout(id).catch((e) => setProblem(errorText(e)));
  };

  const create = () => void window.saturn.git.createBranch(name).then(() => setCreating(false), (e) => setProblem(errorText(e)));

  const items: MenuEntry[] = [
    { group: 'Branches' },
    ...branches.map((b) => ({ id: b, label: b, hint: b === status.branch ? 'current' : undefined, testId: `branch-${b}` })),
    { separator: true },
    { id: NEW_BRANCH, label: 'New branch…', testId: 'branch-new' },
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
      {creating && (
        <div class="absolute z-20 top-7 left-0 w-72 p-2.5 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-2" data-testid="branch-new-form">
          <div class="font-semibold text-strong">New branch from {status.branch ?? 'HEAD'}</div>
          <TextInput
            value={name}
            onInput={setName}
            placeholder="Branch name"
            testId="branch-new-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
          <div class="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" testId="branch-create" onClick={create}>Create and switch</Button>
          </div>
        </div>
      )}
    </div>
  );
}
