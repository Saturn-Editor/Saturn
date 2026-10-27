import { useRef, useState } from 'preact/hooks';
import type { RecentProject } from '@shared/types';
import { ChevronDownIcon, ContextMenu, type MenuEntry } from '@renderer/components';
import { useWorkspace } from './EditorWorkspace';

const CLOSE = '\0close';

/**
 * The project name in the top bar. Its menu has Close Project, then the other recent projects:
 * picking one opens it and closes this window (the usual unsaved-changes prompt still applies).
 */
export function ProjectMenu() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open) void window.saturn.projects.recent().then(setRecent);
    setOpen(!open);
  };

  const others = recent.filter((p) => p.path !== ws.projectPath && !p.missing);
  const items: MenuEntry[] = [
    { id: CLOSE, label: 'Close Project', testId: 'project-close' },
    ...(others.length ? [{ separator: true } as const, { group: 'Switch to' } as const] : []),
    ...others.map((p) => ({ id: p.path, label: p.name, hint: p.path, testId: `project-switch-${p.name}` })),
  ];

  const pick = async (id: string) => {
    if (id !== CLOSE && (await window.saturn.projects.openPath(id)) !== 'opened') return;
    window.saturn.window.close();
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
      {open && <ContextMenu class="top-7 left-0 w-80" anchor={anchor} items={items} onPick={(id) => void pick(id)} onClose={() => setOpen(false)} />}
    </div>
  );
}
