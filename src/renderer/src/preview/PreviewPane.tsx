import { useEffect, useState } from 'preact/hooks';
import { THEME_TOKENS } from '@shared/types';
import { tokenRgba } from '@renderer/theme/ThemeApplier';
import type { PreviewProvider } from './PreviewRegistry';

const RENDER_DELAY_MS = 200;

/** Theme colours as CSS variables inside the frame, so previews can match the editor. */
function themeStyles(): string {
  const vars = THEME_TOKENS.map((t) => `--saturn-${t}: ${tokenRgba(t)};`).join(' ');
  return `:root { ${vars} } body { margin: 0; padding: 16px 20px; font: 13px/1.6 system-ui, sans-serif;
    background: var(--saturn-editor); color: var(--saturn-text); } a { color: var(--saturn-accent); }`;
}

interface PreviewPaneProps {
  provider: PreviewProvider;
  text: string;
  path: string;
  projectPath: string;
}

/** Renders a file's preview into a sandboxed frame (no scripts), re-rendering as the text changes. */
export function PreviewPane({ provider, text, path, projectPath }: PreviewPaneProps) {
  const [html, setHtml] = useState('');
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    const bump = () => setThemeVersion((v) => v + 1);
    window.addEventListener('saturn:theme', bump);
    return () => window.removeEventListener('saturn:theme', bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const body = await provider.render(text, { path, projectPath });
        if (!cancelled) setHtml(body);
      } catch (e) {
        if (!cancelled) setHtml(`<p>Preview failed: ${String((e as Error).message).replace(/</g, '&lt;')}</p>`);
      }
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, text, path]);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${themeStyles()}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      key={themeVersion}
      title={`${provider.label} preview`}
      sandbox=""
      srcdoc={doc}
      class="w-full h-full border-0 bg-editor"
      data-testid="file-preview"
    />
  );
}
