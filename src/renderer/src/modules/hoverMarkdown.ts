import { marked, type Token, type Tokens } from 'marked';
import { highlightText } from './textmate';

function inline(tokens: Token[] | undefined, parent: HTMLElement): void {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
      case 'em':
      case 'del': {
        const el = document.createElement(t.type === 'strong' ? 'strong' : t.type === 'em' ? 'em' : 's');
        inline((t as Tokens.Strong).tokens, el);
        parent.append(el);
        break;
      }
      case 'codespan': {
        const el = document.createElement('code');
        el.textContent = decode((t as Tokens.Codespan).text);
        parent.append(el);
        break;
      }
      case 'link': {
        const el = document.createElement('span');
        el.className = 'cm-saturn-hover-link';
        inline((t as Tokens.Link).tokens, el);
        parent.append(el);
        break;
      }
      case 'br':
        parent.append(document.createElement('br'));
        break;
      case 'text':
        if ((t as Tokens.Text).tokens) inline((t as Tokens.Text).tokens, parent);
        else parent.append(decode((t as Tokens.Text).text));
        break;
      default:
        parent.append(decode('text' in t ? String(t.text) : t.raw));
    }
  }
}

function decode(text: string): string {
  const area = document.createElement('textarea');
  area.innerHTML = text;
  return area.value;
}

async function code(text: string, fence: string, languageId: string): Promise<HTMLElement> {
  const pre = document.createElement('pre');
  let ranges = fence ? await highlightText(fence, text).catch(() => []) : [];
  if (!ranges.length) ranges = await highlightText(languageId, text).catch(() => []);
  let at = 0;
  for (const r of ranges) {
    if (r.from > at) pre.append(text.slice(at, r.from));
    const span = document.createElement('span');
    span.setAttribute('style', r.style);
    span.textContent = text.slice(r.from, r.to);
    pre.append(span);
    at = r.to;
  }
  if (at < text.length) pre.append(text.slice(at));
  return pre;
}

async function blocks(tokens: Token[], parent: HTMLElement, languageId: string): Promise<void> {
  for (const t of tokens) {
    switch (t.type) {
      case 'code': {
        const c = t as Tokens.Code;
        parent.append(await code(c.text, c.lang?.trim() ?? '', languageId));
        break;
      }
      case 'heading': {
        const el = document.createElement('div');
        el.className = 'cm-saturn-hover-heading';
        inline((t as Tokens.Heading).tokens, el);
        parent.append(el);
        break;
      }
      case 'paragraph': {
        const el = document.createElement('p');
        inline((t as Tokens.Paragraph).tokens, el);
        parent.append(el);
        break;
      }
      case 'list': {
        const list = t as Tokens.List;
        const el = document.createElement(list.ordered ? 'ol' : 'ul');
        for (const item of list.items) {
          const li = document.createElement('li');
          await blocks(item.tokens, li, languageId);
          el.append(li);
        }
        parent.append(el);
        break;
      }
      case 'blockquote': {
        const el = document.createElement('blockquote');
        await blocks((t as Tokens.Blockquote).tokens, el, languageId);
        parent.append(el);
        break;
      }
      case 'hr':
        parent.append(document.createElement('hr'));
        break;
      case 'space':
        break;
      case 'text': {
        const el = document.createElement('p');
        inline((t as Tokens.Text).tokens ?? [t], el);
        parent.append(el);
        break;
      }
      default: {
        const el = document.createElement('p');
        el.textContent = t.raw;
        parent.append(el);
      }
    }
  }
}

export async function renderHover(markdown: string, languageId: string): Promise<HTMLElement> {
  const dom = document.createElement('div');
  dom.className = 'cm-saturn-hover cm-saturn-hover-rich';
  await blocks(marked.lexer(markdown), dom, languageId);
  return dom;
}
