import { describe, expect, it, vi } from 'vitest';

import { closeMemberApi } from '../src/shutdown.js';

describe('Member API shutdown', () => {
  it('reports a close failure without leaking a rejected promise', async () => {
    const failure = new Error('close failed');
    const reportFailure = vi.fn();

    await expect(
      closeMemberApi({ close: vi.fn(async () => Promise.reject(failure)) }, reportFailure),
    ).resolves.toBeUndefined();

    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
