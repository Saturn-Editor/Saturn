import { useRef, useState } from 'preact/hooks';
import type { RecentProject } from '@shared/types';
import { Button, ChevronDownIcon, ContextMenu, type MenuEntry } from '@renderer/components';
import { useWorkspace } from './EditorWorkspace';

const CLOSE = '\0close';
const HOME = '\0home';

/**
 * The project name in the top bar. Its menu has Home (the Welcome window, to create, open or clone a
 * project), Close Project, then the other recent projects. Picking one asks whether to open it in this
 * window (closing this project, with the usual unsaved-changes prompt) or a new one.
 */
export function ProjectMenu() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [choosing, setChoosing] = useState<RecentProject | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open) void window.saturn.projects.recent().then(setRecent);
    setOpen(!open);
  };

  const others = recent.filter((p) => p.path !== ws.projectPath && !p.missing);
  const items: MenuEntry[] = [
    { id: HOME, label: 'Home', hint: 'New, open or clone a project', testId: 'project-home' },
    { id: CLOSE, label: 'Close Project', testId: 'project-close' },
    ...(others.length ? [{ separator: true } as const, { group: 'Switch to' } as const] : []),
    ...others.map((p) => ({ id: p.path, label: p.name, hint: p.path, testId: `project-switch-${p.name}` })),
  ];

  const pick = (id: string) => {
    if (id === HOME) return window.saturn.windows.openWelcome();
    if (id === CLOSE) return window.saturn.window.close();
    setChoosing(others.find((p) => p.path === id) ?? null);
  };

  /** Opens the chosen project; in this window means closing this project once the other has opened. */
  const openChosen = async (here: boolean) => {
    const project = choosing;
    setChoosing(null);
    if (!project || (await window.saturn.projects.openPath(project.path)) !== 'opened') return;
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
