// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isTextTarget } from '@renderer/modules/ExtensionFrame';

describe('extension page keys', () => {
  it('treats text fields and editable text as text targets', () => {
    const input = document.createElement('input');
    input.type = 'text';
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isTextTarget(input)).toBe(true);
    expect(isTextTarget(document.createElement('textarea'))).toBe(true);
    expect(isTextTarget(editable)).toBe(true);
  });

  it('leaves everything else to the extension', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isTextTarget(checkbox)).toBe(false);
    expect(isTextTarget(document.createElement('div'))).toBe(false);
    expect(isTextTarget(null)).toBe(false);
  });
});
