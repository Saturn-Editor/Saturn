type Message =
  | { kind: 'call'; id: number; method: string; args: unknown[] }
  | { kind: 'result'; id: number; value?: unknown; error?: string }
  | { kind: 'notify'; method: string; args: unknown[] };

type Handler = (...args: any[]) => unknown;

/** Minimal request/response + notification channel over any `post`/`onMessage` pair. */
export class Rpc {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly post: (message: Message) => void) {}

  /** Feed every incoming message here. */
  receive(message: Message): void {
    if (message.kind === 'result') {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) waiter?.reject(new Error(message.error));
      else waiter?.resolve(message.value);
      return;
    }
    const handler = this.handlers.get(message.method);
    if (message.kind === 'notify') {
      void handler?.(...message.args);
      return;
    }
    Promise.resolve()
      .then(() => {
        if (!handler) throw new Error(`No handler for ${message.method}`);
        return handler(...message.args);
      })
      .then(
        (value) => this.post({ kind: 'result', id: message.id, value }),
        (e: unknown) => this.post({ kind: 'result', id: message.id, error: e instanceof Error ? e.message : String(e) }),
      );
  }

  handle(method: string, handler: Handler): void {
    this.handlers.set(method, handler);
  }

  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ kind: 'call', id, method, args });
    });
  }

  notify(method: string, ...args: unknown[]): void {
    this.post({ kind: 'notify', method, args });
  }

  /** Fails every outstanding call, e.g. when the other side exits. */
  rejectAll(reason: string): void {
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason));
    this.pending.clear();
  }
}
