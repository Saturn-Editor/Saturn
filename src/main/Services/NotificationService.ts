import type { AppNotification, MessageKind, NotificationAction } from '@shared/modules';

const MAX_NOTIFICATIONS = 100;

/**
 * Notifications for this session (modules send them with `saturn.window.notify`; Saturn sends its
 * own, e.g. a missing tool). Kept in memory, newest first; listeners hear every change.
 */
export class NotificationService {
  private items: AppNotification[] = [];
  private nextId = 1;
  private readonly listeners: ((items: AppNotification[]) => void)[] = [];

  onChanged(listener: (items: AppNotification[]) => void): void {
    this.listeners.push(listener);
  }

  list(): AppNotification[] {
    return this.items;
  }

  add(n: { moduleId: string; title: string; message?: string; kind?: MessageKind; actions?: NotificationAction[] }): void {
    // Only https links can be opened from a notification.
    // Only Saturn itself may offer its own actions (restart to update, Marketplace updates).
    const actions = (n.actions ?? []).filter((a) => a.label && (a.command || a.openSettings || a.url?.startsWith('https://') ||
      ((a.installUpdate || a.openMarketplace || a.updateAll) && n.moduleId === 'saturn')));
    this.items = [{
      id: String(this.nextId++),
      moduleId: n.moduleId,
      title: n.title,
      message: n.message ?? '',
      kind: n.kind ?? 'info',
      actions,
      time: Date.now(),
      read: false,
    }, ...this.items].slice(0, MAX_NOTIFICATIONS);
    this.emit();
  }

  get(id: string): AppNotification | undefined {
    return this.items.find((n) => n.id === id);
  }

  dismiss(id: string): void {
    this.items = this.items.filter((n) => n.id !== id);
    this.emit();
  }

  clear(): void {
    this.items = [];
    this.emit();
  }

  markAllRead(): void {
    if (!this.items.some((n) => !n.read)) return;
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l(this.items));
  }
}
