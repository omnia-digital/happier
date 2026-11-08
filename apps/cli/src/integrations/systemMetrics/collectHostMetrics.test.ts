import { describe, expect, it } from 'vitest';
import { collectHostMetrics } from './collectHostMetrics';

describe('host resource measurement definitions', () => {
    it('honors cancellation before measuring or spawning platform tools', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(collectHostMetrics('machine', controller.signal)).rejects.toThrow();
    });
});
