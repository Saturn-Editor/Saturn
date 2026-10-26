import type { ComponentChild } from 'preact';
import { CloseIcon } from './icons';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  dirty?: boolean;
  closable?: boolean;
  icon?: ComponentChild;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T | null;
  onSelect: (id: T) => void;
  onClose?: (id: T) => void;
  trailing?: ComponentChild;
}

export function Tabs<T extends string>({ tabs, active, onSelect, onClose, trailing }: TabsProps<T>) {
  return (
    <div class="flex items-stretch bg-panel border-b border-divider shrink-0">
      <div class="flex flex-1 items-stretch min-w-0 overflow-x-auto" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(e) => e.button === 1 && tab.closable && onClose?.(tab.id)}
            class={`group flex items-center gap-1.5 pl-3 pr-1.5 h-8 border-r border-divider cursor-pointer whitespace-nowrap ${
              isActive ? 'bg-editor text-strong shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-muted hover:text-strong'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.dirty && <span class="size-1.5 bg-accent" data-testid="dirty-dot" aria-label="Unsaved changes" />}
            {tab.closable && (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                class={`size-5 inline-flex items-center justify-center hover:bg-hover ${isActive ? '' : 'invisible group-hover:visible'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.(tab.id);
                }}
              >
                <CloseIcon class="size-3" />
              </button>
            )}
          </div>
        );
      })}
      </div>
      {/* Pinned to the right, outside the scrolling tab list. */}
      {trailing && <div class="flex items-center gap-0.5 px-1 shrink-0">{trailing}</div>}
    </div>
  );
}
