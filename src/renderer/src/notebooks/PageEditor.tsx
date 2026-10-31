import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { errorText } from '@renderer/helpers';
import { imageAsDataUrl, PAGE_LINK } from './pages';
import { slashMenu, type SlashActions } from './SlashMenu';
import { Toolbar, type LinkTargets } from './Toolbar';
import { PageControls } from './PageControls';
import { NotebookCodeBlock } from './codeBlock';
import './notebook.css';

interface PageEditorProps {
  doc: JSONContent;
  targets: LinkTargets;
  onChange: (doc: JSONContent) => void;
  onOpenPage: (href: string) => void;
  onAddSubpage: SlashActions['addSubpage'];
  onError: (message: string) => void;
}

async function addImages(editor: Editor, files: File[], onError: (message: string) => void): Promise<void> {
  for (const file of files) {
    try {
      editor.chain().focus().setImage({ src: await imageAsDataUrl(file), alt: file.name }).run();
    } catch (e) {
      onError(errorText(e));
    }
  }
}

const images = (list: FileList | undefined | null) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));

export function PageEditor(props: PageEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!host.current) return;
    const menu = document.createElement('div');
    menu.className = 'z-40 bg-raised border border-border shadow-lg shadow-black/40';
    const onError = (message: string) => latest.current.onError(message);
    const editor = new Editor({
      element: host.current,
      content: props.doc,
      extensions: [
        StarterKit.configure({ codeBlock: false, link: { openOnClick: false, protocols: ['saturn-page'] } }),
        NotebookCodeBlock,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Image.configure({ allowBase64: true }),
        TableKit.configure({ table: { resizable: true } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: "Write, or type '/' for blocks…" }),
        BubbleMenu.configure({ element: menu, shouldShow: ({ editor: e, state }) => !state.selection.empty && !e.isActive('image') && !e.isActive('codeBlock') && !e.isActive('table') }),
        slashMenu({ pickImage: () => picker.current?.click(), addSubpage: () => latest.current.onAddSubpage() }),
      ],
      editorProps: {
        attributes: { class: 'notebook-content', 'data-testid': 'notebook-editor' },
        handleClick: (_view, _pos, event) => {
          const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
          if (!href) return false;
          if (href.startsWith(PAGE_LINK)) latest.current.onOpenPage(href);
          else if (/^https?:\/\//.test(href)) window.open(href);
          return true;
        },
        handlePaste: (_view, event) => {
          const files = images(event.clipboardData?.files);
          if (!files.length) return false;
          void addImages(editor, files, onError);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = images(event.dataTransfer?.files);
          if (!files.length) return false;
          event.preventDefault();
          void addImages(editor, files, onError);
          return true;
        },
      },
      onUpdate: ({ editor: e }) => latest.current.onChange(e.getJSON()),
    });
    editorRef.current = editor;
    render(<Toolbar editor={editor} targets={() => latest.current.targets()} />, menu);
    setEditor(editor);
    return () => {
      render(null, menu);
      setEditor(null);
      editor.destroy();
      menu.remove();
      editorRef.current = null;
    };
  }, []);

  return (
    <div ref={wrapper} class="relative max-w-3xl mx-auto px-8 pb-24">
      <div ref={host} />
      {editor && wrapper.current && <PageControls editor={editor} wrapper={wrapper.current} />}
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        multiple
        class="hidden"
        onChange={(e) => {
          if (editorRef.current) void addImages(editorRef.current, images(e.currentTarget.files), latest.current.onError);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
