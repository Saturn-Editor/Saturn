import type { ComponentChild } from 'preact';

export interface SidebarItem<T extends string> {
  id: T;
  label: string;
  icon?: ComponentChild;
}

interface SidebarMenuProps<T extends string> {
  items: SidebarItem<T>[];
  /** Items pinned to the bottom (e.g. About), styled and selected like the rest. */
  bottomItems?: SidebarItem<T>[];
  selected: T | null;
  onSelect: (id: T) => void;
  header?: ComponentChild;
  /** Pinned below everything, e.g. "＋ Add more…". */
  footer?: ComponentChild;
  class?: string;
}

function SidebarMenuItem<T extends string>({ item, selected, onSelect }: { item: SidebarItem<T>; selected: boolean; onSelect: (id: T) => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'page' : undefined}
        onClick={() => onSelect(item.id)}
        class={`w-full flex items-center gap-2 px-3.5 py-1.5 text-left ${selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
      >
        {item.icon}
        {item.label}
      </button>
    </li>
  );
}

/** The left-hand section list used by Welcome, Settings, Marketplace and New Project. */
export function SidebarMenu<T extends string>({ items, bottomItems, selected, onSelect, header, footer, class: cls = 'w-48' }: SidebarMenuProps<T>) {
  return (
    <nav class={`flex flex-col shrink-0 bg-panel border-r border-divider ${cls}`}>
      {header}
      <ul class="m-0 p-0 list-none flex-1 overflow-y-auto">
        {items.map((item) => <SidebarMenuItem key={item.id} item={item} selected={item.id === selected} onSelect={onSelect} />)}
      </ul>
      {bottomItems && bottomItems.length > 0 && (
        <ul class="m-0 p-0 list-none">
          {bottomItems.map((item) => <SidebarMenuItem key={item.id} item={item} selected={item.id === selected} onSelect={onSelect} />)}
        </ul>
      )}
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
