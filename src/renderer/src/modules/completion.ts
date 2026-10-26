import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';

/** Completion from the language's server (via main), triggered while typing a word or on Ctrl+Space. */
export function lspCompletion(path: string, languageId: string): Extension {
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/[\w#`[\]-]*/);
    if (!ctx.explicit && (!word || word.from === word.to)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const items = await window.saturn.modules
      .complete({ path, languageId, text: ctx.state.doc.toString(), line: line.number - 1, character: ctx.pos - line.from })
      .catch(() => []);
    if (ctx.aborted || items.length === 0) return null;
    return {
      from: word?.from ?? ctx.pos,
      options: items.map((i) => ({ label: i.label, detail: i.detail, apply: i.insertText ?? i.label })),
    };
  };
  return autocompletion({ override: [source] });
}
