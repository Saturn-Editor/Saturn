import { signal } from '@preact/signals';

export interface PreviewContext {
  path: string;
  projectPath: string;
}

/**
 * A preview for some file types, contributed by a language (e.g. Markdown renders to HTML).
 * The HTML is shown in a sandboxed frame with scripts disabled.
 */
export interface PreviewProvider {
  id: string;
  label: string;
  /** Extensions it previews, including the dot, e.g. [".md", ".markdown"]. */
  extensions: string[];
  /** The module id that added it. */
  source: string;
  render: (text: string, ctx: PreviewContext) => string | Promise<string>;
}

export type ViewMode = 'code' | 'split' | 'preview';

/** Which file types can be previewed and how. The core registers none; languages add them. */
export class PreviewRegistry {
  private readonly providers = new Map<string, PreviewProvider>();
  readonly changed = signal(0);

  register(provider: PreviewProvider): () => void {
    this.providers.set(provider.id, provider);
    this.changed.value++;
    return () => {
      if (this.providers.get(provider.id) === provider) {
        this.providers.delete(provider.id);
        this.changed.value++;
      }
    };
  }

  /** The provider for a file, by its extension (case-insensitive), if any language previews it. */
  for(path: string): PreviewProvider | undefined {
    const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    return [...this.providers.values()].find((p) => p.extensions.some((ext) => name.endsWith(ext.toLowerCase())));
  }
}
