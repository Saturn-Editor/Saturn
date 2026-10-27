import { FileStore } from './FileStore';

/** Project path → file path → language id ("plain-text" for none). */
type Choices = Record<string, Record<string, string>>;

function isChoices(v: unknown): v is Choices {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Languages the user picked for single files (status bar → language), per project. */
export class LanguageChoiceStore {
  private readonly store: FileStore<Choices>;

  constructor(file: string) {
    this.store = new FileStore(file, {}, isChoices);
  }

  async forProject(projectPath: string): Promise<Record<string, string>> {
    return (await this.store.read())[projectPath] ?? {};
  }

  /** Sets a file's language, or (null) goes back to choosing by extension. */
  async set(projectPath: string, path: string, languageId: string | null): Promise<Record<string, string>> {
    const all = await this.store.update((choices) => {
      const project = { ...(choices[projectPath] ?? {}) };
      if (languageId) project[path] = languageId;
      else delete project[path];
      return { ...choices, [projectPath]: project };
    });
    return all[projectPath] ?? {};
  }
}
