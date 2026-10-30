import { useEffect, useRef, useState } from 'preact/hooks';
import type { RunEntry } from '@shared/types';
import { Button, ChevronDownIcon, ContextMenu, IconButton, PlayIcon, StopIcon, TextInput, type MenuEntry } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { errorText } from '@renderer/helpers';
import { fuzzyScore } from '@renderer/commands/fuzzy';

const ADD = '__add__';
const RUN_LIMIT = 10;

function AddCommandForm({ onSave, onCancel }: { onSave: (name: string, command: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await onSave(name, command);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div class="absolute z-20 top-8 right-0 w-80 p-3 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-2" data-testid="run-add-form">
      <div class="font-semibold text-strong">Add custom command</div>
      <TextInput value={name} onInput={setName} placeholder="Name" testId="run-name" autoFocus />
      <TextInput class="font-mono" value={command} onInput={setCommand} placeholder="Command, e.g. npm run dev" testId="run-command" />
      {error && <p class="m-0 text-accent" role="alert">{error}</p>}
      <div class="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" testId="run-save" onClick={() => void save()}>Save</Button>
      </div>
    </div>
  );
}

/** Run configuration dropdown with ▶ Run and ■ Stop. Runs entries in a Terminal tab. */
export function RunMenu() {
  const ws = useWorkspace();
  const [entries, setEntries] = useState<RunEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpenState] = useState(false);
  const [query, setQuery] = useState('');
  const setMenuOpen = (open: boolean) => {
    setMenuOpenState(open);
    if (!open) setQuery('');
  };
  const selectRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const [runningTerminal, setRunningTerminal] = useState<string | null>(null);
  ws.terminals.tabs.value; // re-render when a run finishes

  const load = async () => {
    setEntries(await window.saturn.run.list());
    setSelectedId(await window.saturn.run.selected());
  };
  useEffect(() => void load(), [ws.modules.version.value]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const run = async () => {
    if (!selected) return setMenuOpen(true);
    const id = await ws.terminals.openTerminal({ name: selected.name, command: selected.command });
    setRunningTerminal(id);
    ws.showTerminal();
  };

  const activePath = ws.documents.activePath.value;
  const activeModule = activePath ? ws.modules.languageFor(activePath)?.moduleId : undefined;
  const q = query.trim();
  const shown = entries
    .map((e, order) => ({ e, order, score: q ? Math.max(fuzzyScore(q, e.name) ?? -Infinity, fuzzyScore(q, e.command) ?? -Infinity) : 0 }))
    .filter((r) => r.score !== -Infinity)
    .sort((a, b) => Number(b.e.source === activeModule) - Number(a.e.source === activeModule) || (q ? b.score - a.score : 0) || a.order - b.order)
    .slice(0, RUN_LIMIT)
    .map((r) => r.e);

  const items: MenuEntry[] = [];
  for (const e of shown) {
    if (!items.some((i) => 'group' in i && i.group === e.group)) items.push({ group: e.group });
    items.push({ id: e.id, label: e.name, hint: e.command });
  }
  if (!shown.length && q) items.push({ group: 'No matching configurations' });
  items.push({ separator: true }, { id: ADD, label: '＋ Add custom command…', testId: 'run-add' });

  const pick = async (id: string) => {
    if (id === ADD) return setAdding(true);
    await window.saturn.run.select(id);
    setSelectedId(id);
  };

  return (
    <div class="relative flex items-center gap-1">
      <div ref={selectRef}>
        <button
          type="button"
          data-testid="run-select"
          onClick={() => setMenuOpen(!menuOpen)}
          class="h-7 px-2 flex items-center gap-2 border border-border hover:bg-hover text-strong"
        >
          <span class="max-w-48 truncate">{selected?.name ?? 'Add configuration…'}</span>
          <ChevronDownIcon class="size-3.5 text-muted" />
        </button>
        {menuOpen && (
          <div class="absolute z-30 top-8 right-0 w-72 p-1.5 bg-raised border border-border border-b-0">
            <TextInput
              class="w-full"
              value={query}
              placeholder="Search run configurations"
              testId="run-search"
              autoFocus
              onInput={setQuery}
              onKeyDown={(e) => {
                const first = shown[0];
                if (e.key === 'Enter' && first) {
                  setMenuOpen(false);
                  void pick(first.id);
                }
              }}
            />
          </div>
        )}
      </div>
      <IconButton icon={<PlayIcon class="size-3.5 text-accent" />} label="Run" data-testid="run-start" onClick={() => void run()} />
      <IconButton
        icon={<StopIcon class="size-3.5" />}
        label="Stop"
        disabled={!ws.terminals.isRunning(runningTerminal)}
        onClick={() => runningTerminal && ws.terminals.stop(runningTerminal)}
      />
      {menuOpen && (
        <ContextMenu class="top-[4.25rem] right-0 w-72" anchor={selectRef} items={items} onPick={(id) => void pick(id)} onClose={() => setMenuOpen(false)} />
      )}
      {adding && (
        <AddCommandForm
          onCancel={() => setAdding(false)}
          onSave={async (name, command) => {
            await window.saturn.run.addCustom({ name, command });
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}
