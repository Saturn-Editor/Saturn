import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSONContent } from '@tiptap/core';
import { DEFAULT_PAGE_STYLE, emptyPage, isPageFile, type PageFile, type PageStyle } from '@shared/notebooks';
import { Button, IconButton } from '@renderer/components';
import { errorText } from '@renderer/helpers';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';
import { createSubpage, listPages, PAGE_LINK, pageTitle, renamePage, subpageFolder } from './pages';
import { PageEditor } from './PageEditor';
import { FONT_CLASS, StyleEditor, styleVariables } from './StyleEditor';

const SAVE_DELAY_MS = 400;

export function PageView({ path }: { path: string }) {
  const ws = useWorkspace();
  const [page, setPage] = useState<PageFile | null>(null);
  const [title, setTitle] = useState(pageTitle(path));
  const [styling, setStyling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = useRef<PageFile | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dirty = useRef(false);
  const [defaults, setDefaults] = useState<PageStyle>(DEFAULT_PAGE_STYLE);
  useEffect(() => {
    const read = () => void window.saturn.notebooks.style().then(setDefaults);
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);

  const save = () => {
    clearTimeout(timer.current);
    if (!dirty.current || !current.current) return;
    dirty.current = false;
    void window.saturn.fs.writeFile(path, JSON.stringify(current.current)).catch((e) => setProblem(errorText(e)));
  };

  const change = (next: PageFile, now = false) => {
    current.current = next;
    dirty.current = true;
    setPage(next);
    clearTimeout(timer.current);
    if (now) save();
    else timer.current = setTimeout(save, SAVE_DELAY_MS);
  };

  useEffect(() => {
    setTitle(pageTitle(path));
    void window.saturn.fs.readFile(path, { force: true }).then((result) => {
      if (result.kind !== 'text') throw new Error("This page can't be read");
      const parsed: unknown = result.text.trim() ? JSON.parse(result.text) : emptyPage();
      if (!isPageFile(parsed)) throw new Error("This file isn't a Saturn notebook page");
      current.current = parsed;
      setPage(parsed);
    }).catch((e) => setProblem(errorText(e)));
    return save;
  }, [path]);

  const rename = async () => {
    const next = title.trim();
    if (!next || next === pageTitle(path)) return setTitle(pageTitle(path));
    try {
      save();
      current.current = null;
      const to = await renamePage(path, next);
      ws.documents.moved(subpageFolder(path), subpageFolder(to));
      ws.documents.moved(path, to);
    } catch (e) {
      setProblem(errorText(e));
      setTitle(pageTitle(path));
    }
  };

  if (!page) return <div class="h-full flex items-center justify-center text-muted bg-editor">{problem ?? 'Loading…'}</div>;
  const own = page.font !== undefined || page.background !== undefined || page.text !== undefined;
  const style: PageStyle = {
    font: page.font ?? defaults.font,
    background: page.background !== undefined ? page.background : defaults.background,
    text: page.text !== undefined ? page.text : defaults.text,
  };
  const root = ws.projectPath;

  return (
    <div class="relative h-full flex flex-col bg-editor" data-testid="notebook-page">
      <div class="flex items-center justify-end gap-1 h-9 px-2.5 shrink-0">
        <IconButton class="size-7" icon={<span class="font-serif text-[13px]">Aa</span>} label="Page style" active={styling} data-testid="notebook-style" onClick={() => setStyling(!styling)} />
      </div>
      {styling && (
        <div class="absolute z-30 top-10 right-2.5 w-[440px] p-3 bg-raised border border-border shadow-lg shadow-black/40" data-testid="notebook-style-popover">
          <StyleEditor
            value={style}
            onChange={(next) => change({ ...current.current!, font: next.font, background: next.background, text: next.text }, true)}
          />
          <div class="flex justify-between mt-3">
            <Button disabled={!own} onClick={() => {
              const { font: _f, background: _b, text: _t, ...rest } = current.current!;
              change(rest, true);
            }}>Use defaults</Button>
            <Button onClick={() => setStyling(false)}>Done</Button>
          </div>
        </div>
      )}
      {problem && <button type="button" class="px-3 py-1 text-left text-accent border-b border-divider" onClick={() => setProblem(null)}>{problem}</button>}
      <div class={`flex-1 min-h-0 overflow-y-auto bg-editor text-text ${FONT_CLASS[style.font]}`} style={styleVariables(style)}>
        <input
          class="block mx-auto w-full max-w-3xl px-8 pt-4 pb-2 bg-transparent text-3xl font-semibold text-strong outline-none placeholder:text-muted"
          style={{ fontFamily: 'inherit' }}
          placeholder="Untitled"
          value={title}
          data-testid="notebook-page-title"
          onInput={(e) => setTitle(e.currentTarget.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div class="max-w-3xl mx-auto px-8"><hr class="border-0 border-t border-divider mt-2 mb-5" /></div>
        <PageEditor
          key={path}
          doc={page.doc as JSONContent}
          onChange={(doc) => change({ ...current.current!, doc })}
          targets={async () => (await listPages(root)).filter((p) => p.path !== path).map((p) => ({ href: `${PAGE_LINK}${p.path.slice(root.length + 1)}`, title: p.title }))}
          onOpenPage={(href) => void ws.documents.open(`${root}/${href.slice(PAGE_LINK.length)}`)}
          onAddSubpage={async () => {
            try {
              save();
              const created = await createSubpage(path);
              return { href: `${PAGE_LINK}${created.path.slice(root.length + 1)}`, title: created.title };
            } catch (e) {
              setProblem(errorText(e));
              return null;
            }
          }}
          onError={setProblem}
        />
      </div>
    </div>
  );
}
