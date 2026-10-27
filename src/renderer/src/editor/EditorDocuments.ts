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

/** A tab that isn't an editable file: a file that can't be shown as text, or a Git diff. */
export interface InfoDoc {
  /** The tab's id: the file's path, or "diff:…" for a diff. */
  path: string;
  name: string;
  reason: 'binary' | 'too-large' | 'diff';
  bytes?: number;
  /** For a commit's diff: the unified diff text. */
  diff?: string;
  /** For uncommitted changes: the project-relative file, whose diff stays current. */
  workingPath?: string;
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
  /**
   * Split editor: a second editor beside the first. `activePath` is always the focused side's file;
   * `otherPath` is the other side's. Both sides share the open tabs.
   */
  readonly split = signal(false);
  readonly focused = signal<0 | 1>(0);
  readonly otherPath = signal<string | null>(null);
  /** A line and optional column (both 1-based) the editor should jump to once that file is showing. */
  readonly reveal = signal<{ path: string; line: number; column?: number } | null>(null);

  constructor(private readonly api: Pick<SaturnApi, 'fs' | 'window'>) {}

  /** The file one side of the editor shows (0 is the left, or the only, editor). */
  pathFor(group: 0 | 1): string | null {
    return group === this.focused.value ? this.activePath.value : this.otherPath.value;
  }

  /** Moves focus to one side of the split; `activePath` becomes that side's file. */
  focus(group: 0 | 1): void {
    if (group === this.focused.value || !this.split.value) return;
    const was = this.activePath.value;
    this.activePath.value = this.otherPath.value;
    this.otherPath.value = was;
    this.focused.value = group;
  }

  /** Split Right opens the current file in a second editor; closing the split keeps the focused side's file. */
  toggleSplit(): void {
    if (this.split.value) {
      this.split.value = false;
      this.focused.value = 0;
      this.otherPath.value = null;
      return;
    }
    this.otherPath.value = this.activePath.value;
    this.split.value = true;
    this.focus(1);
  }

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

  /** Opens (or refreshes and switches to) a read-only diff tab: a commit's `diff` text, or a file's live `workingPath` changes. */
  openDiff(id: string, name: string, source: { diff: string } | { workingPath: string }): void {
    const tab: InfoDoc = { path: `diff:${id}`, name, reason: 'diff', ...source };
    const existing = this.infos.value.some((i) => i.path === tab.path);
    this.infos.value = existing ? this.infos.value.map((i) => (i.path === tab.path ? tab : i)) : [...this.infos.value, tab];
    this.activePath.value = tab.path;
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
    const remaining = this.tabOrder();
    const next = remaining[Math.max(0, index - 1)] ?? null;
    if (this.activePath.value === path) this.activePath.value = next;
    if (this.otherPath.value === path) this.otherPath.value = next;
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
    if (this.otherPath.value) this.otherPath.value = move(this.otherPath.value);
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

  /**
   * Re-reads every open file without unsaved changes (e.g. after a branch switch or pull) so editors
   * show what's on disk. Files that no longer exist are closed.
   */
  async reloadClean(): Promise<void> {
    for (const doc of this.docs.value.filter((d) => !d.dirty)) {
      const result = await this.api.fs.readFile(doc.path).catch(() => null);
      if (!result) {
        this.close(doc.path);
        continue;
      }
      if (result.kind !== 'text') continue;
      const text = result.text.replace(/\r\n/g, '\n');
      // Skip if it was edited while reading, or hasn't changed.
      const current = this.docs.value.find((d) => d.path === doc.path);
      if (!current || current.dirty || current.text === text) continue;
      this.docs.value = this.docs.value.map((d) => (d.path === doc.path ? { ...d, text, savedText: text, eol: result.eol } : d));
    }
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
