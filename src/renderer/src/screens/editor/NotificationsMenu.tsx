import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppNotification } from '@shared/modules';
import { BellIcon, Button, CloseIcon, IconButton } from '@renderer/components';
import { errorText } from '@renderer/helpers';

const TOAST_MS = 6000;

/**
 * The bell next to Settings: a count of unread notifications, and a menu listing them with their
 * actions. Opening the menu marks everything read. A notification that arrives while the window is
 * open also pops up briefly at the bottom right (it stays in the menu too).
 */
export function NotificationsMenu() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    void window.saturn.notifications.list().then((list) => {
      // Ones that were already there when the window opened don't pop up.
      seen.current = new Set(list.map((n) => n.id));
      setItems(list);
    });
    return window.saturn.notifications.onChanged((all) => {
      const project = window.saturn.window.projectPath;
      const list = all.filter((n) => !n.projectPath || n.projectPath === project);
      const fresh = seen.current ? list.find((n) => !n.read && !seen.current!.has(n.id)) : undefined;
      for (const n of list) seen.current?.add(n.id);
      if (fresh) setToast(fresh);
      setItems(list);
    });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.id]);
  // A dismissed or cleared notification's pop-up goes too.
  const shownToast = toast && items.some((n) => n.id === toast.id) ? toast : null;
  // Close on a click outside the menu or Escape.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;
  const toggle = () => {
    setProblem(null);
    if (!open) void window.saturn.notifications.markAllRead();
    setOpen(!open);
  };
  const act = (n: AppNotification, index: number) => {
    setProblem(null);
    void window.saturn.notifications.act(n.id, index).catch((e) => setProblem(errorText(e)));
  };

  return (
    <div ref={root} class="relative">
      <IconButton icon={<BellIcon />} label={unread ? `Notifications (${unread} unread)` : 'Notifications'} data-testid="notifications" active={open} onClick={toggle} />
      {unread > 0 && (
        <span class="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.5 bg-accent text-on-accent text-[9px] font-semibold leading-3.5 text-center pointer-events-none" data-testid="notifications-count">
          {unread}
        </span>
      )}
      {shownToast && !open && (
        <div class="fixed z-40 bottom-8 right-4 w-80 px-3 py-2.5 bg-raised border border-border shadow-lg shadow-black/40" role="status" data-testid="notification-toast">
          <div class="flex items-start gap-2">
            <span class={`flex-1 font-semibold ${shownToast.kind === 'info' ? 'text-strong' : 'text-accent'}`}>{shownToast.title}</span>
            <IconButton icon={<CloseIcon class="size-3" />} label="Hide" class="size-5" onClick={() => setToast(null)} />
          </div>
          {shownToast.message && <p class="m-0 mt-1 text-text break-words whitespace-pre-line">{shownToast.message}</p>}
          {shownToast.actions.length > 0 && (
            <div class="flex flex-wrap gap-2 mt-2">
              {shownToast.actions.map((a, i) => <Button key={a.label} onClick={() => {
                act(shownToast, i);
                setToast(null);
              }}>{a.label}</Button>)}
            </div>
          )}
        </div>
      )}
      {open && (
        <div class="absolute z-20 top-8 right-0 w-96 max-h-[60vh] flex flex-col bg-raised border border-border shadow-lg shadow-black/40" data-testid="notifications-menu">
          <div class="flex items-center px-3 py-2 border-b border-divider">
            <span class="flex-1 font-semibold text-strong">Notifications</span>
            {items.length > 0 && <button type="button" class="text-muted hover:text-strong" onClick={() => void window.saturn.notifications.clear()}>Clear all</button>}
          </div>
          <div class="overflow-y-auto">
            {items.length === 0 && <p class="m-0 px-3 py-4 text-muted">No notifications.</p>}
            {items.map((n) => (
              <div key={n.id} class="px-3 py-2.5 border-b border-divider" data-testid="notification">
                <div class="flex items-start gap-2">
                  <span class={`flex-1 font-semibold ${n.kind === 'info' ? 'text-strong' : 'text-accent'}`}>{n.title}</span>
                  <IconButton icon={<CloseIcon class="size-3" />} label="Dismiss" class="size-5" onClick={() => void window.saturn.notifications.dismiss(n.id)} />
                </div>
                {n.message && <p class="m-0 mt-1 text-text select-text break-words whitespace-pre-line">{n.message}</p>}
                {n.actions.length > 0 && (
                  <div class="flex flex-wrap gap-2 mt-2">
                    {n.actions.map((a, i) => <Button key={a.label} onClick={() => act(n, i)}>{a.label}</Button>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          {problem && <p class="m-0 px-3 py-2 text-accent" role="alert">{problem}</p>}
        </div>
      )}
    </div>
  );
}
