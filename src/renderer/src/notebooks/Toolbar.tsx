import { useEffect, useState } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { TextInput } from '@renderer/components';

function Tool({ label, title, active, onClick }: { label: string; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      class={`h-6 min-w-6 px-1.5 ${active ? 'bg-selection text-strong' : 'text-text hover:bg-hover'}`}
    >
      {label}
    </button>
  );
}

const Divider = () => <span class="w-px h-4 mx-0.5 bg-divider" />;

export type LinkTargets = () => Promise<{ href: string; title: string }[]>;

function LinkForm({ editor, targets, onDone }: { editor: Editor; targets: LinkTargets; onDone: () => void }) {
  const [pages, setPages] = useState<{ href: string; title: string }[]>([]);
  useEffect(() => void targets().then(setPages), []);
  const [url, setUrl] = useState((editor.getAttributes('link').href as string | undefined) ?? '');
  const apply = (href: string) => {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    onDone();
  };
  return (
    <div class="w-64 p-1.5 flex flex-col gap-1" data-testid="notebook-link">
      <TextInput
        value={url}
        onInput={setUrl}
        placeholder="https://…"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && /^https?:\/\//.test(url.trim())) apply(url.trim());
          if (e.key === 'Escape') onDone();
        }}
      />
      <div class="text-muted px-1 pt-0.5">Or link to a page</div>
      <div class="max-h-40 overflow-y-auto">
        {pages.map((p) => (
          <button type="button" key={p.href} class="w-full text-left px-1.5 h-6 truncate hover:bg-hover" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(p.href)}>
            {p.title}
          </button>
        ))}
      </div>
      {editor.isActive('link') && (
        <button type="button" class="text-left px-1.5 text-muted hover:text-strong" onClick={() => {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          onDone();
        }}>Remove link</button>
      )}
    </div>
  );
}

export function Toolbar({ editor, targets }: { editor: Editor; targets: LinkTargets }) {
  const [, setVersion] = useState(0);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const reset = () => setLinking(false);
    editor.on('transaction', bump);
    editor.on('selectionUpdate', reset);
    return () => {
      editor.off('transaction', bump);
      editor.off('selectionUpdate', reset);
    };
  }, [editor]);

  if (linking) return <LinkForm editor={editor} targets={targets} onDone={() => setLinking(false)} />;

  const chain = () => editor.chain().focus();
  return (
    <div class="flex items-center gap-0.5 p-0.5" data-testid="notebook-toolbar">
      <Tool label="B" title="Bold" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
      <Tool label="I" title="Italic" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
      <Tool label="U" title="Underline" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
      <Tool label="S" title="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
      <Tool label="<>" title="Inline code" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()} />
      <Divider />
      <Tool label="Left" title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()} />
      <Tool label="Centre" title="Align centre" active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()} />
      <Tool label="Right" title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => chain().setTextAlign('right').run()} />
      <Divider />
      <Tool label="Link" title="Link" active={editor.isActive('link')} onClick={() => setLinking(true)} />
    </div>
  );
}
