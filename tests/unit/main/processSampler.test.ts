import { describe, expect, it } from 'vitest';
import { createSampler, parsePs } from '../../../src/main/Helpers/processSampler';

describe('process sampling', () => {
  it('reads ps output as CPU percent and memory in MB', () => {
    expect(parsePs('  12.5  204800\n')).toEqual({ cpu: 12.5, memoryMb: 200 });
    expect(parsePs('')).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('samples a real process', async () => {
    const sample = await createSampler(process.pid)();
    expect(sample).not.toBeNull();
    expect(sample!.memoryMb).toBeGreaterThan(1);
    expect(sample!.cpu).toBeGreaterThanOrEqual(0);
  });

  it('gives nothing for a process that has gone', async () => {
    expect(await createSampler(2 ** 22 + 12345)()).toBeNull();
  });
});
