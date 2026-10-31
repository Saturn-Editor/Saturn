import { useEffect, useState } from 'preact/hooks';
import type { ContributionSnapshot } from '@shared/modules';
import type { RecentTypedProject } from '@shared/types';
import { Button, ContextMenu, TextInput } from '@renderer/components';
import { errorText, pluralName } from '@renderer/helpers';

type ProjectType = ContributionSnapshot['projectTypes'][number];

export function ProjectTypePage({ type }: { type: ProjectType }) {
  const [recent, setRecent] = useState<RecentTypedProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; project: RecentTypedProject } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = () => void window.saturn.projectTypes.recent(type.id).then(setRecent);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [type.id]);

  const run = (task: Promise<unknown>) => {
    setProblem(null);
    void task.then(load, (e) => setProblem(errorText(e)));
  };

  const create = () => {
    setProblem(null);
    void window.saturn.projectTypes.create(type.id, name).then(() => {
      setCreating(false);
      setName('');
      load();
    }, (e) => setProblem(errorText(e)));
  };

  const q = query.trim().toLowerCase();
  const visible = recent.filter((p) => !q || p.name.toLowerCase().includes(q));

  return (
    <main class="flex-1 flex flex-col p-3.5 min-w-0" data-testid={`welcome-type-${type.id}`}>
      <div class="flex gap-2 mb-3.5">
        <TextInput class="flex-1" value={query} onInput={setQuery} placeholder={`Search ${pluralName(type.name).toLowerCase()}`} />
        <Button variant="primary" testId="type-new" onClick={() => setCreating(!creating)}>New</Button>
        <Button testId="type-open" onClick={() => run(window.saturn.projectTypes.openDialog(type.id))}>Open</Button>
      </div>
      {type.description && <p class="mt-0 mb-3.5 text-muted">{type.description}</p>}
      {creating && (
        <div class="mb-3.5 p-2.5 border border-border bg-raised flex flex-col gap-2" data-testid="type-new-form">
          <TextInput value={name} onInput={setName} placeholder={`${type.name} name`} autoFocus testId="type-new-name" onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
          <div class="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" testId="type-create" disabled={!name.trim()} onClick={create}>Create</Button>
          </div>
        </div>
      )}
      {problem && <p class="mt-0 mb-3.5 text-accent" role="alert">{problem}</p>}
      <div class="flex-1 overflow-y-auto">
        {visible.map((p) => (
          <button
            type="button"
            key={p.path}
            data-testid="type-row"
            disabled={p.missing}
            title={p.path}
            onClick={() => run(window.saturn.projectTypes.open(type.id, p.path))}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, project: p });
            }}
            class="w-full flex flex-col items-start px-2.5 py-1.5 text-left hover:bg-hover disabled:opacity-50"
          >
            <span class="text-strong">{p.name}</span>
            <span class="text-muted truncate max-w-full">{p.missing ? 'Folder not found' : p.path}</span>
          </button>
        ))}
        {recent.length === 0 && <p class="text-muted px-2.5">Nothing here yet. Create one to get started.</p>}
      </div>
      {menu && (
        <ContextMenu
          at={menu}
          items={[{ id: 'remove', label: 'Remove from list' }]}
          onPick={() => run(window.saturn.projectTypes.remove(type.id, menu.project.path))}
          onClose={() => setMenu(null)}
        />
      )}
    </main>
  );
}
