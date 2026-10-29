import { useRef, useState } from 'preact/hooks';
import { Button, ChevronDownIcon, ContextMenu, type MenuEntry } from '@renderer/components';
import { useWorkspace } from './EditorWorkspace';

const CLOSE = '\0close';
const NEW = '\0new';
const OPEN = '\0open';

/**
 * The project or notebook name in the top bar. Its menu has New and Open Project (projects only), Close,
 * then the other recent projects and notebooks. Picking one asks whether to open it in this window or a new one.
 */
interface Target {
  kind: 'project' | 'notebook';
  name: string;
  path: string;
}

export function ProjectMenu() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Target[]>([]);
  const [notebooks, setNotebooks] = useState<Target[]>([]);
  const [choosing, setChoosing] = useState<Target | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open) {
      const usable = (list: { name: string; path: string; missing: boolean }[], kind: Target['kind']) =>
        list.filter((t) => t.path !== ws.projectPath && !t.missing).map((t) => ({ kind, name: t.name, path: t.path }));
      void window.saturn.projects.recent().then((list) => setProjects(usable(list, 'project')));
      void window.saturn.notebooks.list().then((list) => setNotebooks(usable(list, 'notebook')));
    }
    setOpen(!open);
  };

  const targetItem = (t: Target) => ({ id: `${t.kind}:${t.path}`, label: t.name, hint: t.path, testId: `${t.kind}-switch-${t.name}` });
  const items: MenuEntry[] = [
    ...(ws.isNotebook ? [] : [
      { id: NEW, label: 'New Project…', testId: 'project-new' },
      { id: OPEN, label: 'Open Project…', testId: 'project-open' },
    ]),
    { id: CLOSE, label: ws.isNotebook ? 'Close Notebook' : 'Close Project', testId: 'project-close' },
    ...(projects.length ? [{ separator: true } as const, { group: 'Switch to' } as const, ...projects.map(targetItem)] : []),
    ...(notebooks.length ? [{ separator: true } as const, { group: 'Notebooks' } as const, ...notebooks.map(targetItem)] : []),
  ];

  const pick = (id: string) => {
    if (id === NEW) return window.saturn.windows.openNewProject();
    if (id === OPEN) return void window.saturn.projects.openDialog();
    if (id === CLOSE) return window.saturn.window.close();
    setChoosing([...projects, ...notebooks].find((t) => `${t.kind}:${t.path}` === id) ?? null);
  };

  const openChosen = async (here: boolean) => {
    const target = choosing;
    setChoosing(null);
    if (!target) return;
    if (target.kind === 'notebook') await window.saturn.notebooks.open(target.path);
    else if ((await window.saturn.projects.openPath(target.path)) !== 'opened') return;
    if (here) window.saturn.window.close();
  };

  return (
    <div class="relative min-w-0 flex">
      <button
        ref={anchor}
        type="button"
        data-testid="project-name"
        onClick={toggle}
        class="h-6 px-1 flex items-center gap-1 min-w-0 font-semibold text-strong hover:bg-hover"
      >
        <span class="truncate">{ws.projectName}</span>
        <ChevronDownIcon class="size-3 shrink-0 text-muted" />
      </button>
      {open && <ContextMenu class="top-7 left-0 w-80" anchor={anchor} items={items} onPick={pick} onClose={() => setOpen(false)} />}
      {choosing && (
        <div
          class="absolute z-20 top-7 left-0 w-80 p-2.5 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-2"
          data-testid="project-open-choice"
          onKeyDown={(e) => e.key === 'Escape' && setChoosing(null)}
        >
          <div class="font-semibold text-strong">Open {choosing.name}</div>
          <p class="m-0 text-muted">In this window closes {ws.projectName}.</p>
          <div class="flex justify-end gap-2">
            <Button onClick={() => setChoosing(null)}>Cancel</Button>
            <Button testId="project-open-new-window" onClick={() => void openChosen(false)}>New window</Button>
            <Button variant="primary" testId="project-open-here" onClick={() => void openChosen(true)}>This window</Button>
          </div>
        </div>
      )}
    </div>
  );
}
