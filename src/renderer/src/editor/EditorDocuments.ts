import { computed, signal } from '@preact/signals';
import type { SaturnApi } from '@shared/api';

export interface OpenDoc {
  path: string;
  name: string;
  text: string;
  savedText: string;
  eol: 'LF' | 'CRLF';
  dirty: boolean;
}

export type OpenResult = 'opened' | 'binary' | 'too-large';

/** A file that couldn't be shown as text, displayed as an info tab instead. */
export interface InfoDoc {
  path: string;
  name: string;
  reason: 'binary' | 'too-large';
  bytes?: number;
}

const TYPING_SAVE_MS = 2000;
const IDLE_SAVE_MS = 1000;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Is `path` the same as `dir` or inside it? */
function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`);
}

/** The files open in an editor window, their unsaved text and which one is active. */
export class EditorDocuments {
  readonly docs = signal<OpenDoc[]>([]);
  readonly infos = signal<InfoDoc[]>([]);
  readonly activePath = signal<string | null>(null);
  readonly active = computed(() => this.docs.value.find((d) => d.path === this.activePath.value) ?? null);
  /** A line and optional column (both 1-based) the editor should jump to once that file is showing. */
  readonly reveal = signal<{ path: string; line: number; column?: number } | null>(null);

  constructor(private readonly api: Pick<SaturnApi, 'fs' | 'window'>) {}

  /** Settings → Editor → Behaviour → Auto-save. */
  autoSave: 'typing' | 'idle' | 'off' = 'idle';
  /** Pending auto-saves per file. */
  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** "typing": at most one save per 2s while changes keep coming; "idle": 1s after the last change. */
  private scheduleAutoSave(path: string): void {
    if (this.autoSave === 'off') return;
    const pending = this.saveTimers.get(path);
    if (pending && this.autoSave === 'typing') return;
    clearTimeout(pending);
    this.saveTimers.set(path, setTimeout(() => {
      this.saveTimers.delete(path);
      if (this.isDirty(path)) void this.save(path).catch((e) => console.error('Auto-save failed', e));
    }, this.autoSave === 'typing' ? TYPING_SAVE_MS : IDLE_SAVE_MS));
  }

  /** With "idle" auto-save, leaving the window saves every changed file. */
  saveOnLeave(): void {
    if (this.autoSave === 'idle') void this.saveAll().catch((e) => console.error('Auto-save failed', e));
  }

  /** Opens still reading their file, so a quick second click on the same file doesn't open a second tab. */
  private readonly opening = new Map<string, Promise<OpenResult>>();

  /** Opens (or switches to) a file; `line` and `column` (1-based) move the cursor there. */
  async open(path: string, opts: { force?: boolean; line?: number; column?: number } = {}): Promise<OpenResult> {
    if (opts.line) this.reveal.value = { path, line: opts.line, column: opts.column };
    if (this.docs.value.some((d) => d.path === path)) {
      this.activePath.value = path;
      return 'opened';
    }
    const pending = this.opening.get(path);
    if (pending) return pending;
    const load = this.load(path, opts).finally(() => this.opening.delete(path));
    this.opening.set(path, load);
    return load;
  }

  private async load(path: string, opts: { force?: boolean }): Promise<OpenResult> {
    const result = await this.api.fs.readFile(path, opts);
    this.infos.value = this.infos.value.filter((i) => i.path !== path);
    if (result.kind !== 'text') {
      this.infos.value = [...this.infos.value, { path, name: baseName(path), reason: result.kind, bytes: result.kind === 'too-large' ? result.bytes : undefined }];
      this.activePath.value = path;
      return result.kind;
    }
    // CodeMirror works in LF; line endings are restored on save.
    const text = result.text.replace(/\r\n/g, '\n');
    this.docs.value = [...this.docs.value, { path, name: baseName(path), text, savedText: text, eol: result.eol, dirty: false }];
    this.activePath.value = path;
    return 'opened';
  }

  close(path: string): void {
    clearTimeout(this.saveTimers.get(path));
    this.saveTimers.delete(path);
    // With "idle" auto-save, closing a changed tab saves it first.
    if (this.autoSave === 'idle' && this.isDirty(path)) {
      void this.save(path).then(() => this.close(path), (e) => console.error('Auto-save failed', e));
      return;
    }
    const order = this.tabOrder();
    const index = order.indexOf(path);
    this.docs.value = this.docs.value.filter((d) => d.path !== path);
    this.infos.value = this.infos.value.filter((i) => i.path !== path);
    if (this.activePath.value === path) {
      const remaining = this.tabOrder();
      this.activePath.value = remaining[Math.max(0, index - 1)] ?? null;
    }
    this.reportDirty();
  }

  /** Closes every tab for `path` or anything inside it (after it was deleted). */
  closeUnder(path: string): void {
    for (const p of this.tabOrder()) if (isUnder(p, path)) this.close(p);
  }

  /** Points tabs at their new location after `from` was renamed to `to` (a file, or a folder containing them). */
  moved(from: string, to: string): void {
    const move = (p: string) => (isUnder(p, from) ? to + p.slice(from.length) : p);
    this.docs.value = this.docs.value.map((d) => (isUnder(d.path, from) ? { ...d, path: move(d.path), name: baseName(move(d.path)) } : d));
    this.infos.value = this.infos.value.map((i) => (isUnder(i.path, from) ? { ...i, path: move(i.path), name: baseName(move(i.path)) } : i));
    if (this.activePath.value) this.activePath.value = move(this.activePath.value);
  }

  setText(path: string, text: string): void {
    this.docs.value = this.docs.value.map((d) => (d.path === path ? { ...d, text, dirty: text !== d.savedText } : d));
    this.reportDirty();
    if (this.isDirty(path)) this.scheduleAutoSave(path);
  }

  async save(path = this.activePath.value): Promise<void> {
    const doc = this.docs.value.find((d) => d.path === path);
    if (!doc) return;
    const text = doc.eol === 'CRLF' ? doc.text.replace(/\n/g, '\r\n') : doc.text;
    await this.api.fs.writeFile(doc.path, text);
    this.docs.value = this.docs.value.map((d) => (d.path === doc.path ? { ...d, savedText: doc.text, dirty: false } : d));
    this.reportDirty();
  }

  async saveAll(): Promise<void> {
    for (const d of this.docs.value.filter((x) => x.dirty)) await this.save(d.path);
  }

  isDirty(path = this.activePath.value): boolean {
    return this.docs.value.some((d) => d.path === path && d.dirty);
  }

  anyDirty(): boolean {
    return this.docs.value.some((d) => d.dirty);
  }

  /** Paths in tab order (text docs and info tabs, in the order they were opened). */
  tabOrder(): string[] {
    return [...this.docs.value.map((d) => d.path), ...this.infos.value.map((i) => i.path)];
  }

  private reportDirty(): void {
    this.api.window.setDirty(this.anyDirty());
  }
}
