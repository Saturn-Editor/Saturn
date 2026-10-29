import CodeBlock from '@tiptap/extension-code-block';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { highlightText } from '@renderer/modules/textmate';

export interface CodeLanguage {
  id: string;
  name: string;
}

let languages: CodeLanguage[] = [];
let loading: Promise<void> | null = null;

function loadLanguages(): Promise<void> {
  loading ??= window.saturn.modules.snapshot().then((s) => {
    languages = s.languages.map((l) => ({ id: l.id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name));
  }, () => undefined);
  return loading;
}

const highlightKey = new PluginKey<DecorationSet>('codeHighlight');
const cache = new Map<string, { from: number; to: number; style: string }[]>();

function decorate(doc: PmNode): { set: DecorationSet; missing: { language: string; text: string }[] } {
  const decorations: Decoration[] = [];
  const missing: { language: string; text: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const language = node.attrs.language as string | null;
    if (!language) return false;
    const key = `${language}\0${node.textContent}`;
    const spans = cache.get(key);
    if (!spans) missing.push({ language, text: node.textContent });
    for (const s of spans ?? []) decorations.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { style: s.style }));
    return false;
  });
  return { set: DecorationSet.create(doc, decorations), missing };
}

export const NotebookCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'notebook-code';
      const select = document.createElement('select');
      select.className = 'notebook-code-language';
      select.contentEditable = 'false';
      select.title = 'Language';
      select.dataset.testid = 'code-language';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);
      wrapper.append(select, pre);

      const fill = (current: string | null) => {
        select.replaceChildren(
          new Option('Plain text', ''),
          ...languages.map((l) => new Option(l.name, l.id)),
        );
        select.value = current ?? '';
      };
      fill(node.attrs.language);
      void loadLanguages().then(() => fill(select.value || node.attrs.language));
      select.addEventListener('mousedown', (e) => e.stopPropagation());
      select.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: select.value || null }));
      });

      return {
        dom: wrapper,
        contentDOM: code,
        update(updated) {
          if (updated.type.name !== 'codeBlock') return false;
          node = updated;
          if (select.value !== (updated.attrs.language ?? '')) fill(updated.attrs.language);
          return true;
        },
        ignoreMutation: (m) => m.target === select || select.contains(m.target as Node),
        stopEvent: (e) => e.target === select,
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: (_config, state) => decorate(state.doc).set,
          apply: (tr, old, _oldState, state) => (tr.docChanged || tr.getMeta(highlightKey) ? decorate(state.doc).set : old.map(tr.mapping, tr.doc)),
        },
        props: { decorations: (state) => highlightKey.getState(state) },
        view: (view) => {
          const pending = new Set<string>();
          const request = () => {
            for (const { language, text } of decorate(view.state.doc).missing) {
              const key = `${language}\0${text}`;
              if (pending.has(key)) continue;
              pending.add(key);
              void highlightText(language, text).then((spans) => {
                if (cache.size > 500) cache.clear();
                cache.set(key, spans);
                pending.delete(key);
                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true));
              });
            }
          };
          request();
          return { update: request };
        },
      }),
    ];
  },
});
