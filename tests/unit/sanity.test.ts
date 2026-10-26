import { describe, expect, it } from 'vitest';
import { CHANNEL_PREFIX } from '@shared/api';

describe('shared api', () => {
  it('uses the saturn channel prefix', () => {
    expect(CHANNEL_PREFIX).toBe('saturn:');
  });
});
