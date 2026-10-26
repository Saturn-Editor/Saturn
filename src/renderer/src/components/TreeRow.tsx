import type { ComponentChild } from 'preact';
import { ChevronDownIcon, ChevronRightIcon } from './icons';

interface TreeRowProps {
  depth: number;
  label: string;
  /** undefined for leaf rows; true/false for expandable rows. */
  expanded?: boolean;
  selected?: boolean;
  icon?: ComponentChild;
  onClick: () => void;
  onDoubleClick?: () => void;
}

export function TreeRow({ depth, label, expanded, selected, icon, onClick, onDoubleClick }: TreeRowProps) {
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={selected}
      tabIndex={-1}
      onClick={onClick}
      onDblClick={onDoubleClick}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      class={`flex items-center gap-1 h-6 pr-2 cursor-pointer whitespace-nowrap ${selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
    >
      <span class="size-3.5 shrink-0 text-muted">
        {expanded === true && <ChevronDownIcon class="size-3.5" />}
        {expanded === false && <ChevronRightIcon class="size-3.5" />}
      </span>
      {icon}
      <span class="truncate">{label}</span>
    </div>
  );
}
