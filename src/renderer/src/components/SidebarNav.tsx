import type { ComponentChild } from 'preact';

export interface SidebarItem<T extends string> {
  id: T;
  label: string;
  icon?: ComponentChild;
}

interface SidebarNavProps<T extends string> {
  items: SidebarItem<T>[];
  selected: T | null;
  onSelect: (id: T) => void;
  header?: ComponentChild;
  /** Pinned to the bottom of the sidebar, e.g. "＋ Add more…". */
  footer?: ComponentChild;
  class?: string;
}

export function SidebarNav<T extends string>({ items, selected, onSelect, header, footer, class: cls = 'w-48' }: SidebarNavProps<T>) {
  return (
    <nav class={`flex flex-col shrink-0 bg-panel border-r border-divider ${cls}`}>
      {header}
      <ul class="m-0 p-0 list-none flex-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.id === selected ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              class={`w-full flex items-center gap-2 px-3.5 py-1.5 text-left ${
                item.id === selected ? 'bg-selection text-strong' : 'hover:bg-hover'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {footer && <div class="border-t border-divider">{footer}</div>}
    </nav>
  );
}

/** A footer row styled to match sidebar items. */
export function SidebarFooterButton({ label, onClick, disabled, title }: { label: string; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      class="w-full px-3.5 py-1.5 text-left text-muted hover:bg-hover hover:text-strong disabled:opacity-50 disabled:pointer-events-none"
    >
      {label}
    </button>
  );
}
