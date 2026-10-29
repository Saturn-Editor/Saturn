import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_PAGE_STYLE, type NotebookFolder, type PageStyle } from '@shared/notebooks';
import { Button, Heading } from '@renderer/components';
import { errorText } from '@renderer/helpers';
import { FONT_CLASS, StyleEditor, styleVariables } from './StyleEditor';
import './notebook.css';

const same = (a: PageStyle, b: PageStyle) => a.font === b.font && a.background === b.background && a.text === b.text;

export function NotebookSettings({ setSection }: { setSection?: (section: 'appearance') => void }) {
  const [folder, setFolder] = useState<NotebookFolder | null>(null);
  const [offer, setOffer] = useState<{ from: string; count: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [style, setStyle] = useState<PageStyle | null>(null);
  useEffect(() => {
    void window.saturn.notebooks.folder().then(setFolder);
    void window.saturn.notebooks.style().then(setStyle);
  }, []);
  if (!folder || !style) return null;

  const change = async (next: Promise<NotebookFolder>) => {
    const previous = folder.path;
    const updated = await next;
    setFolder(updated);
    setMessage(null);
    if (updated.path === previous) return;
    const count = await window.saturn.notebooks.countIn(previous);
    setOffer(count ? { from: previous, count } : null);
  };

  const move = async () => {
    if (!offer) return;
    try {
      const { moved, skipped } = await window.saturn.notebooks.moveFrom(offer.from);
      setMessage(`Moved ${moved} notebook${moved === 1 ? '' : 's'}.${skipped.length ? ` Close ${skipped.join(', ')} and move ${skipped.length === 1 ? 'it' : 'them'} again.` : ''}`);
    } catch (e) {
      setMessage(errorText(e));
    }
    setOffer(null);
  };

  const saveStyle = (next: PageStyle) => {
    setStyle(next);
    void window.saturn.notebooks.setStyle(next);
  };

  return (
    <section data-testid="settings-notebooks">
      <Heading>Storage</Heading>
      <div class="flex items-center gap-2 mb-3">
        <div class="flex-1 min-w-0 h-7 px-2 flex items-center bg-editor border border-border truncate" title={folder.path} data-testid="notebook-folder">
          {folder.path}
        </div>
        <Button testId="notebook-folder-choose" onClick={() => void change(window.saturn.notebooks.chooseFolder())}>Change…</Button>
        <Button disabled={folder.isDefault} onClick={() => void change(window.saturn.notebooks.resetFolder())}>Use default</Button>
      </div>
      {offer && (
        <div class="flex items-center gap-2 mb-3 p-2.5 bg-raised border border-border" data-testid="notebook-move-offer">
          <span class="flex-1">Move {offer.count === 1 ? 'the notebook' : `the ${offer.count} notebooks`} in the previous folder here too?</span>
          <Button onClick={() => setOffer(null)}>Keep where they are</Button>
          <Button variant="primary" testId="notebook-move" onClick={() => void move()}>Move</Button>
        </div>
      )}
      {message && <p class="mt-0 mb-3 text-muted" role="status">{message}</p>}
      <Heading class="mt-5">Default page style</Heading>
      <StyleEditor value={style} defaultLabel="Use theme default" onChange={saveStyle} />
      <div class="flex items-center gap-3 mt-3">
        <Button disabled={same(style, DEFAULT_PAGE_STYLE)} onClick={() => saveStyle(DEFAULT_PAGE_STYLE)}>Reset to theme defaults</Button>
        <Button onClick={() => setSection?.('appearance')}>Theme settings</Button>
      </div>
      <Heading class="mt-5">Preview</Heading>
      <div class={`border border-border bg-editor text-text px-6 py-5 ${FONT_CLASS[style.font]}`} style={styleVariables(style)} data-testid="notebook-style-preview">
        <div class="text-2xl font-semibold text-strong" style={{ fontFamily: 'inherit' }}>Meeting notes</div>
        <hr class="border-0 border-t border-divider my-3" />
        <div class="notebook-content" style={{ minHeight: 0 }}>
          <h2>Agenda</h2>
          <p>Review last week's <strong>actions</strong> and agree the <em>next steps</em> for the launch.</p>
          <ul data-type="taskList">
            <li data-checked="true"><label><input type="checkbox" checked disabled /></label><div>Send the draft to the team</div></li>
            <li data-checked="false"><label><input type="checkbox" disabled /></label><div>Book the review for Thursday</div></li>
          </ul>
          <p>Notes are saved in <code>Meeting notes.snp</code>.</p>
        </div>
      </div>
    </section>
  );
}
