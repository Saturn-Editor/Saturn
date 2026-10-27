import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import { Menu, type MenuEntry } from './Menu';

interface ContextMenuProps {
  items: MenuEntry[];
  onPick: (id: string) => void;
  /** Called on a click outside the menu or Escape. */
  onClose: () => void;
  /** Opens at a point on screen (right-click); otherwise position it with `class`, relative to its parent. */
  at?: { x: number; y: number };
  class?: string;
  /** The button that toggles this menu: clicks on it are left to the button instead of closing the menu. */
  anchor?: RefObject<HTMLElement | null>;
}

/**
 * A pop-up menu of actions: right-click menus, dropdowns and Apply → Light/Dark. Closes itself on a
 * click elsewhere or Escape, and after an item is picked.
 */
export function ContextMenu({ items, onPick, onClose, at, class: cls = 'w-52', anchor }: ContextMenuProps) {
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!anchor?.current?.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [onClose, anchor]);

  return (
    <Menu
      at={at}
      class={cls}
      items={items}
      selectedIndex={-1}
      onPick={(id) => {
        onClose();
        onPick(id);
      }}
    />
  );
}
