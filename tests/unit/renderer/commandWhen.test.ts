import { describe, expect, it } from 'vitest';
import { commandVisible } from '@renderer/commands/CommandRegistry';

describe('scoped extension commands', () => {
  const none = { projectType: null, activeDocument: null };

  it('shows commands without a when everywhere', () => {
    expect(commandVisible(undefined, none)).toBe(true);
  });

  it('limits commands to a project type or a focused document', () => {
    expect(commandVisible({ projectType: 'diagrams' }, { ...none, projectType: 'diagrams' })).toBe(true);
    expect(commandVisible({ projectType: 'diagrams' }, { ...none, projectType: 'api' })).toBe(false);
    expect(commandVisible({ document: 'diagrams.board' }, { ...none, activeDocument: 'diagrams.board' })).toBe(true);
    expect(commandVisible({ document: 'diagrams.board' }, none)).toBe(false);
  });
});
