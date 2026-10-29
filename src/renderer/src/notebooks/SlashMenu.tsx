import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

export interface SlashActions {
  pickImage: () => void;
  addSubpage: () => Promise<{ href: string; title: string } | null>;
}

interface Block {
  label: string;
  keywords: string;
  run: (editor: Editor, range: Range, actions: SlashActions) => void;
}

const BLOCKS: Block[] = [
  { label: 'Text', keywords: 'paragraph plain', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { label: 'Heading 1', keywords: 'h1 title', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: 'Heading 2', keywords: 'h2 subtitle', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: 'Heading 3', keywords: 'h3', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: 'Bulleted list', keywords: 'ul unordered', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: 'Numbered list', keywords: 'ol ordered', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: 'To-do list', keywords: 'task checkbox check', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: 'Quote', keywords: 'blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: 'Code block', keywords: 'pre snippet', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: 'Table', keywords: 'grid', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: 'Divider', keywords: 'hr rule line', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  {
    label: 'Image',
    keywords: 'picture photo',
    run: (e, r, a) => {
      e.chain().focus().deleteRange(r).run();
      a.pickImage();
    },
  },
  {
    label: 'Page',
    keywords: 'subpage child',
    run: (e, r, a) => {
      e.chain().focus().deleteRange(r).run();
      void a.addSubpage().then((page) => {
        if (page) e.chain().focus().insertContent({ type: 'text', text: page.title, marks: [{ type: 'link', attrs: { href: page.href } }] }).run();
      });
    },
  },
];

function matching(query: string): Block[] {
  const q = query.toLowerCase();
  return BLOCKS.filter((b) => b.label.toLowerCase().includes(q) || b.keywords.includes(q));
}

function List({ items, selected, onPick }: { items: Block[]; selected: number; onPick: (b: Block) => void }) {
  if (!items.length) return <div class="px-2 py-1 text-muted">No matching blocks</div>;
  return (
    <>
      {items.map((b, i) => (
        <button
          type="button"
          key={b.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(b)}
          class={`w-full text-left px-2 h-7 ${i === selected ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
        >
          {b.label}
        </button>
      ))}
    </>
  );
}

function Popup({ props, keys }: { props: SuggestionProps<Block>; keys: { handler: ((e: KeyboardEvent) => boolean) | null } }) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [props.query]);
  keys.handler = (e) => {
    if (e.key === 'ArrowDown') setSelected((s) => (s + 1) % Math.max(props.items.length, 1));
    else if (e.key === 'ArrowUp') setSelected((s) => (s - 1 + props.items.length) % Math.max(props.items.length, 1));
    else if (e.key === 'Enter' && props.items[selected]) props.command(props.items[selected]);
    else return false;
    return true;
  };
  return <List items={props.items} selected={selected} onPick={(b) => props.command(b)} />;
}

export function slashMenu(actions: SlashActions) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion<Block>({
          editor: this.editor,
          pluginKey: new PluginKey('slashMenu'),
          char: '/',
          startOfLine: false,
          items: ({ query }) => matching(query),
          command: ({ editor, range, props }) => props.run(editor, range, actions),
          render: () => {
            let el: HTMLDivElement | null = null;
            const keys: { handler: ((e: KeyboardEvent) => boolean) | null } = { handler: null };
            const place = (props: SuggestionProps<Block>) => {
              const rect = props.clientRect?.();
              if (!el || !rect) return;
              el.style.left = `${rect.left}px`;
              el.style.top = `${rect.bottom + 4}px`;
              render(<Popup props={props} keys={keys} />, el);
            };
            return {
              onStart: (props) => {
                el = document.createElement('div');
                el.className = 'fixed z-50 w-56 max-h-72 overflow-y-auto py-1 bg-raised border border-border shadow-lg shadow-black/40';
                el.dataset.testid = 'notebook-slash-menu';
                document.body.appendChild(el);
                place(props);
              },
              onUpdate: place,
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                if (event.key === 'Escape') {
                  el?.remove();
                  return true;
                }
                return keys.handler?.(event) ?? false;
              },
              onExit: () => {
                if (el) render(null, el);
                el?.remove();
                el = null;
              },
            };
          },
        }),
      ];
    },
  });
}
