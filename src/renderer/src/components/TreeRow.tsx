import type { ComponentChild } from 'preact';
import { ChevronDownIcon, ChevronRightIcon } from './icons';

interface TreeRowProps {
  depth: number;
  label: string;
  /** undefined for leaf rows; true/false for expandable rows. */
  expanded?: boolean;
  selected?: boolean;
  icon?: ComponentChild;
  /** Muted text after the label. */
  description?: string;
  tooltip?: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  /** Clicking the chevron; when set, only the chevron expands and the row click is free for opening. */
  onToggle?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}

export function TreeRow({ depth, label, expanded, selected, icon, description, tooltip, onClick, onDoubleClick, onToggle, onContextMenu }: TreeRowProps) {
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={selected}
      tabIndex={-1}
      title={tooltip}
      onClick={onClick}
      onDblClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      class={`flex items-center gap-1 h-6 pr-2 cursor-pointer whitespace-nowrap ${selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
    >
      <span
        class="size-3.5 shrink-0 text-muted"
        data-testid={onToggle && expanded !== undefined ? 'tree-chevron' : undefined}
        onClick={onToggle && expanded !== undefined ? (e) => {
          e.stopPropagation();
          onToggle();
        } : undefined}
      >
        {expanded === true && <ChevronDownIcon class="size-3.5" />}
        {expanded === false && <ChevronRightIcon class="size-3.5" />}
      </span>
      {icon}
      <span class="truncate">{label}</span>
      {description && <span class="text-muted truncate">{description}</span>}
    </div>
  );
}
