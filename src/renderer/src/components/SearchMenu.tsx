import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';
import { Menu } from './Menu';
import { TextInput } from './inputs';

export interface SearchMenuItem {
  id: string;
  label: string;
  icon?: ComponentChild;
  hint?: string;
  testId?: string;
}

interface SearchMenuProps {
  at: { x: number; y: number };
  title: string;
  items: SearchMenuItem[];
  placeholder?: string;
  limit?: number;
  recentKey: string;
  onPick: (id: string) => void;
  onClose: () => void;
  testId?: string;
}

const RECENT_KEEP = 20;

function readRecent(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRecent(key: string, id: string): void {
  try {
    localStorage.setItem(key, JSON.stringify([id, ...readRecent(key).filter((x) => x !== id)].slice(0, RECENT_KEEP)));
  } catch {
    return;
  }
}

export function SearchMenu({ at, title, items, placeholder = 'Search', limit = 10, recentKey, onPick, onClose, testId }: SearchMenuProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const recent = readRecent(recentKey);

  const q = query.trim().toLowerCase();
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const shown = items
    .map((item, order) => ({ item, order }))
    .filter(({ item }) => !q || item.label.toLowerCase().includes(q) || (item.hint ?? '').toLowerCase().includes(q))
    .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.order - b.order)
    .slice(0, limit)
    .map(({ item }) => item);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [onClose]);

  const pick = (id: string) => {
    rememberRecent(recentKey, id);
    onClose();
    onPick(id);
  };

  return (
    <div ref={box} class="fixed z-30 w-64" style={{ left: `${at.x}px`, top: `${at.y}px` }} data-testid={testId}>
      <div class="p-1.5 bg-raised border border-border border-b-0 shadow-lg shadow-black/40">
        <div class="px-1.5 pb-1 font-semibold text-strong">{title}</div>
        <TextInput
          class="w-full h-6"
          value={query}
          onInput={setQuery}
          placeholder={placeholder}
          autoFocus
          testId={testId && `${testId}-search`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSelected((s) => Math.min(shown.length - 1, s + 1));
            else if (e.key === 'ArrowUp') setSelected((s) => Math.max(0, s - 1));
            else if (e.key === 'Enter' && shown[selected]) pick(shown[selected].id);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      </div>
      <div class="relative">
        {shown.length
          ? <Menu class="left-0 right-0 top-0 border-t-0" items={shown} selectedIndex={selected} onHover={setSelected} onPick={pick} />
          : <div class="absolute left-0 right-0 top-0 px-3 py-2 text-muted bg-raised border border-border border-t-0">Nothing matches</div>}
      </div>
    </div>
  );
}
