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

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The files open in an editor window, their unsaved text and which one is active. */
export class EditorDocuments {
  readonly docs = signal<OpenDoc[]>([]);
  readonly infos = signal<InfoDoc[]>([]);
  readonly activePath = signal<string | null>(null);
  readonly active = computed(() => this.docs.value.find((d) => d.path === this.activePath.value) ?? null);
  /** A line (1-based) the editor should jump to once that file is showing. */
  readonly reveal = signal<{ path: string; line: number } | null>(null);

  constructor(private readonly api: Pick<SaturnApi, 'fs' | 'window'>) {}

  /** Opens (or switches to) a file; `line` (1-based) moves the cursor there. */
  async open(path: string, opts: { force?: boolean; line?: number } = {}): Promise<OpenResult> {
    if (opts.line) this.reveal.value = { path, line: opts.line };
    if (this.docs.value.some((d) => d.path === path)) {
      this.activePath.value = path;
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

  close(path: string): void {
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

  setText(path: string, text: string): void {
    this.docs.value = this.docs.value.map((d) => (d.path === path ? { ...d, text, dirty: text !== d.savedText } : d));
    this.reportDirty();
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
