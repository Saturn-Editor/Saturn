import { computed, signal } from '@preact/signals';
import type { SaturnApi } from '@shared/api';
import { baseName, parentOf } from '@renderer/helpers';

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
  reason: 'binary' | 'too-large' | 'diff' | 'merge' | 'page';
  bytes?: number;
  /** For a commit's diff: the unified diff text. */
  diff?: string;
  /** For uncommitted changes: the project-relative file, whose diff stays current. */
  workingPath?: string;
  mergePath?: string;
}

/** How many editors a split can have. */
const MAX_GROUPS = 4;
const TYPING_SAVE_MS = 2000;
const IDLE_SAVE_MS = 1000;


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
   * Split editor: up to MAX_GROUPS editors side by side ("right") or stacked ("down"), all sharing the
   * open tabs. `activePath` is always the focused group's file; `groupPaths` holds every group's file
   * (the focused group's entry is kept in step with `activePath`).
   */
  readonly groupPaths = signal<(string | null)[]>([null]);
  readonly focused = signal(0);
  readonly splitDirection = signal<'right' | 'down'>('right');
  readonly split = computed(() => this.groupPaths.value.length > 1);
  /** A line and optional column (both 1-based) the editor should jump to once that file is showing. */
  readonly reveal = signal<{ path: string; line: number; column?: number } | null>(null);

  constructor(private readonly api: Pick<SaturnApi, 'fs' | 'window'>) {}

  /** The file a group shows (0 is the first, or the only, editor). */
  pathFor(group: number): string | null {
    return group === this.focused.value ? this.activePath.value : (this.groupPaths.value[group] ?? null);
  }

  /** Moves focus to a group; `activePath` becomes its file. */
  focus(group: number): void {
    if (group === this.focused.value || group >= this.groupPaths.value.length) return;
    this.syncFocused();
    this.focused.value = group;
    this.activePath.value = this.groupPaths.value[group] ?? null;
  }

  /** Shows a file in a group (e.g. a tab dragged there), focusing it. */
  showIn(group: number, path: string): void {
    this.focus(group);
    this.activePath.value = path;
  }

  /** Split Right / Split Down: a new editor after the focused one, showing the same file, focused. */
  splitEditor(direction: 'right' | 'down' = this.splitDirection.value): void {
    if (this.groupPaths.value.length >= MAX_GROUPS) return;
    this.syncFocused();
    this.splitDirection.value = direction;
    const at = this.focused.value + 1;
    const paths = [...this.groupPaths.value];
    paths.splice(at, 0, this.activePath.value);
    this.groupPaths.value = paths;
    this.focused.value = at;
  }

  /** Closes one editor of a split (the focused one by default); its neighbour takes focus. */
  closeGroup(group = this.focused.value): void {
    if (this.groupPaths.value.length <= 1) return;
    this.syncFocused();
    const paths = this.groupPaths.value.filter((_, i) => i !== group);
    const next = Math.min(group === this.focused.value ? Math.max(0, group - 1) : this.focused.value - (group < this.focused.value ? 1 : 0), paths.length - 1);
    this.groupPaths.value = paths;
    this.focused.value = next;
    this.activePath.value = paths[next] ?? null;
  }

  /** Closes every split but the focused editor. */
  unsplit(): void {
    this.groupPaths.value = [this.activePath.value];
    this.focused.value = 0;
  }

  /** Splits if there's one editor, else closes the focused split (the Split Editor command). */
  toggleSplit(): void {
    if (this.split.value) this.closeGroup();
    else this.splitEditor();
  }

  /** Records the focused group's file in `groupPaths` before focus or the groups change. */
  private syncFocused(): void {
    const paths = [...this.groupPaths.value];
    paths[this.focused.value] = this.activePath.value;
    this.groupPaths.value = paths;
  }

  /** Settings → Editor → Behaviour → Auto-save. */
  autoSave: 'typing' | 'idle' | 'off' = 'idle';
  /** Pending auto-saves per file. */
  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly diskVersion = signal(0);
  singlePage = false;

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
    if (path.toLowerCase().endsWith('.snp')) {
      if (this.singlePage) this.infos.value = this.infos.value.filter((i) => i.reason !== 'page');
      this.openInfo({ path, name: this.pageName?.(path) ?? baseName(path).slice(0, -4), reason: 'page' });
      return 'opened';
    }
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
    this.openInfo({ path: `diff:${id}`, name, reason: 'diff', ...source });
  }

  private openInfo(tab: InfoDoc): void {
    const existing = this.infos.value.some((i) => i.path === tab.path);
    this.infos.value = existing ? this.infos.value.map((i) => (i.path === tab.path ? tab : i)) : [...this.infos.value, tab];
    this.activePath.value = tab.path;
  }

  openMerge(path: string): void {
    this.openInfo({ path: `diff:merge:${path}`, name: `${baseName(path)} (merge)`, reason: 'merge', mergePath: path });
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
    this.groupPaths.value = this.groupPaths.value.map((p, i) => (i !== this.focused.value && p === path ? next : p));
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
    this.infos.value = this.infos.value.map((i) => (isUnder(i.path, from) ? { ...i, path: move(i.path), name: i.reason === 'page' ? i.name : baseName(move(i.path)) } : i));
    if (this.activePath.value) this.activePath.value = move(this.activePath.value);
    this.groupPaths.value = this.groupPaths.value.map((p) => (p ? move(p) : p));
  }

  pageName: ((path: string) => string) | null = null;

  renamePages(): void {
    const name = this.pageName;
    if (!name) return;
    this.infos.value = this.infos.value.map((i) => (i.reason === 'page' ? { ...i, name: name(i.path) } : i));
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
  async reloadClean(dir?: string): Promise<void> {
    const inDir = (path: string) => dir === undefined || parentOf(path) === dir;
    if (this.infos.value.some((i) => !i.diff && inDir(i.path))) this.diskVersion.value++;
    for (const doc of this.docs.value.filter((d) => !d.dirty && inDir(d.path))) {
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
