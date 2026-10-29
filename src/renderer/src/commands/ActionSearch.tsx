import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge, Menu, TextInput } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { shortcutFor } from './keymap';

/** The search box in the top bar: finds and runs any registered command. */
export function ActionSearch() {
  const ws = useWorkspace();
  ws.commands.changed.value; // re-render when commands change
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // A command, so the keymap can bind it (⌘⇧A, Ctrl+Q, ⌘⇧P…).
  useEffect(() => ws.commands.register({
    id: 'core.searchActions',
    title: 'Search Actions',
    source: { id: 'core', label: 'Saturn' },
    run: () => {
      input.current?.focus();
      setOpen(true);
    },
  }), []);
  const searchShortcut = shortcutFor('core.searchActions');

  const results = ws.commands.search(query, 12);

  const close = () => {
    setOpen(false);
    setQuery('');
    setIndex(0);
    input.current?.blur();
  };

  const runCommand = (id: string) => {
    close();
    void ws.commands.run(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setIndex((i) => Math.min(results.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter' && results[index]) runCommand(results[index].id);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  };

  return (
    <div class="relative w-[420px] min-w-24 shrink">
      <TextInput
        class="w-full"
        inputRef={input}
        value={query}
        placeholder={searchShortcut ? `Search actions  ${searchShortcut}` : 'Search actions'}
        testId="action-search"
        onInput={(v) => {
          setQuery(v);
          setIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 && (
        <Menu
          class="top-8 left-0 right-0"
          selectedIndex={index}
          onHover={setIndex}
          onPick={runCommand}
          items={results.map((c) => {
            const shortcut = shortcutFor(c.id);
            return {
              id: c.id,
              label: c.title,
              icon: c.source.icon ?? <Badge text={c.source.label.slice(0, 2)} />,
              hint: shortcut ? `${c.source.label} · ${shortcut}` : c.source.label,
            };
          })}
        />
      )}
    </div>
  );
}
