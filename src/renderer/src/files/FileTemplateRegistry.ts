import { signal } from '@preact/signals';
import type { ComponentChild } from 'preact';

export interface FileTemplateContext {
  /** What the user typed, e.g. "OrderService". */
  name: string;
  /** The folder it's being created in. */
  dir: string;
  projectPath: string;
}

/**
 * An entry in the explorer's "New" menu. The core adds File and Folder; languages add their own
 * (e.g. Java adds "Java Class" that names the file `<name>.java` and writes a class skeleton).
 */
export interface FileTemplate {
  id: string;
  label: string;
  kind: 'file' | 'dir';
  icon?: ComponentChild;
  /** 'core' or the module id that added it. */
  source: 'core' | string;
  /** Placeholder for the name box, e.g. "Class name". */
  placeholder?: string;
  /** Shown in the menu and added to names typed without one, e.g. ".md". */
  extension?: string;
  /** Turns the typed name into the file name; defaults to the name plus `extension` when it has none. */
  fileName?: (ctx: FileTemplateContext) => string;
  /** Starting text for the new file; defaults to empty. */
  content?: (ctx: FileTemplateContext) => string | Promise<string>;
  /** For module templates: file name and content in one round trip. Overrides fileName/content. */
  build?: (ctx: FileTemplateContext) => Promise<{ fileName: string | null; content: string }>;
}

/** The templates offered when creating something in the file explorer. */
export class FileTemplateRegistry {
  private readonly templates = new Map<string, FileTemplate>();
  readonly changed = signal(0);

  register(template: FileTemplate): () => void {
    this.templates.set(template.id, template);
    this.changed.value++;
    return () => {
      if (this.templates.get(template.id) === template) {
        this.templates.delete(template.id);
        this.changed.value++;
      }
    };
  }

  get(id: string): FileTemplate | undefined {
    return this.templates.get(id);
  }

  /** File templates: language ones first, then the core's. */
  files(): FileTemplate[] {
    const files = [...this.templates.values()].filter((t) => t.kind === 'file');
    return [...files.filter((t) => t.source !== 'core'), ...files.filter((t) => t.source === 'core')];
  }

  /** Folder templates: the core's Folder first, then language ones. */
  dirs(): FileTemplate[] {
    const dirs = [...this.templates.values()].filter((t) => t.kind === 'dir');
    return [...dirs.filter((t) => t.source === 'core'), ...dirs.filter((t) => t.source !== 'core')];
  }
}

/** The file name a template produces for what the user typed. */
export function templateFileName(template: FileTemplate, ctx: FileTemplateContext): string {
  if (template.fileName) return template.fileName(ctx);
  const hasExtension = ctx.name.includes('.');
  return template.extension && !hasExtension ? `${ctx.name}${template.extension}` : ctx.name;
}
