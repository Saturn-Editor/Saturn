import type { ComponentChild } from 'preact';

export type MenuEntry =
  | { id: string; label: string; icon?: ComponentChild; hint?: string; testId?: string }
  | { group: string }
  | { separator: true };

interface MenuProps {
  items: MenuEntry[];
  /** Index into the clickable items only (groups are skipped). */
  selectedIndex: number;
  onPick: (id: string) => void;
  onHover?: (index: number) => void;
  class?: string;
  /** Opens at a point on screen (e.g. a right-click) instead of relative to its parent. */
  at?: { x: number; y: number };
}

/** A floating list of actions with optional bold group headings. Position it with `class` or `at`. */
export function Menu({ items, selectedIndex, onPick, onHover, class: cls = '', at }: MenuProps) {
  let clickable = -1;
  return (
    <div
      role="menu"
      style={at && { left: `${at.x}px`, top: `${at.y}px` }}
      onPointerDown={(e) => e.stopPropagation()}
      class={`${at ? 'fixed' : 'absolute'} z-20 py-1 bg-raised border border-border shadow-lg shadow-black/40 ${cls}`}
    >
      {items.map((item, i) => {
        if ('group' in item) {
          return <div key={`g${i}`} class="px-3 pt-2 pb-1 font-semibold text-strong">{item.group}</div>;
        }
        if ('separator' in item) return <div key={`s${i}`} role="separator" class="my-1 border-t border-divider" />;
        const index = ++clickable;
        return (
          <div
            key={item.id}
            role="menuitem"
            data-testid={item.testId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item.id)}
            onMouseEnter={() => onHover?.(index)}
            class={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${index === selectedIndex ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
          >
            {item.icon}
            <span class="flex-1 truncate">{item.label}</span>
            {item.hint && <span class="text-muted text-[11px]">{item.hint}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Number of clickable entries in a menu. */
export function clickableCount(items: MenuEntry[]): number {
  return items.filter((i) => 'id' in i).length;
}
