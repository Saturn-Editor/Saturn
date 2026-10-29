import { useEffect, useState } from 'preact/hooks';
import type { NotebookSummary } from '@shared/notebooks';
import { Button, ContextMenu, TextInput } from '@renderer/components';
import { errorText } from '@renderer/helpers';

function NewNotebookForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = async () => {
    setProblem(null);
    try {
      await window.saturn.notebooks.create(name);
      onCancel();
    } catch (e) {
      setProblem(errorText(e));
    }
  };
  return (
    <div class="mb-3.5 p-2.5 border border-border bg-raised flex flex-col gap-2" data-testid="notebook-new-form">
      <TextInput value={name} onInput={setName} placeholder="Notebook name" autoFocus testId="notebook-new-name" onKeyDown={(e) => e.key === 'Enter' && void create()} />
      {problem && <p class="m-0 text-accent" role="alert">{problem}</p>}
      <div class="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" testId="notebook-create" disabled={!name.trim()} onClick={() => void create()}>Create</Button>
      </div>
    </div>
  );
}

export function NotebooksPage() {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; notebook: NotebookSummary } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = () => void window.saturn.notebooks.list().then(setNotebooks);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const run = (task: Promise<unknown>) => {
    setProblem(null);
    void task.then(load, (e) => setProblem(errorText(e)));
  };

  const q = query.trim().toLowerCase();
  const visible = notebooks.filter((n) => !q || n.name.toLowerCase().includes(q));

  return (
    <main class="flex-1 flex flex-col p-3.5 min-w-0" data-testid="welcome-notebooks">
      <div class="flex gap-2 mb-3.5">
        <TextInput class="flex-1" value={query} onInput={setQuery} placeholder="Search notebooks" />
        <Button variant="primary" testId="notebook-new" onClick={() => setCreating(!creating)}>New</Button>
        <Button testId="notebook-open" onClick={() => run(window.saturn.notebooks.openDialog())}>Open</Button>
      </div>
      {creating && <NewNotebookForm onCancel={() => {
        setCreating(false);
        load();
      }} />}
      {problem && <p class="mt-0 text-accent" role="alert">{problem}</p>}
      <div class="flex-1 overflow-y-auto">
        {visible.map((n) => (
          <button
            type="button"
            key={n.path}
            data-testid="notebook-row"
            disabled={n.missing}
            title={n.path}
            onClick={() => run(window.saturn.notebooks.open(n.path))}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, notebook: n });
            }}
            class="w-full flex flex-col items-start px-2.5 py-1.5 text-left hover:bg-hover disabled:opacity-50"
          >
            <span class="text-strong">{n.name}</span>
            <span class="text-muted truncate max-w-full">{n.missing ? 'Folder not found' : n.path}</span>
          </button>
        ))}
        {notebooks.length === 0 && <p class="text-muted px-2.5">No notebooks yet. Create one to get started.</p>}
      </div>
      {menu && (
        <ContextMenu
          at={menu}
          items={[
            ...(menu.notebook.missing ? [] : [{ id: 'open', label: 'Open' }]),
            { id: 'remove', label: 'Remove from list' },
            ...(menu.notebook.missing ? [] : [{ separator: true } as const, { id: 'delete', label: 'Move to Trash', testId: 'notebook-delete' }]),
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const { path } = menu.notebook;
            if (id === 'open') run(window.saturn.notebooks.open(path));
            if (id === 'remove') run(window.saturn.notebooks.remove(path));
            if (id === 'delete') run(window.saturn.notebooks.delete(path));
          }}
        />
      )}
    </main>
  );
}
