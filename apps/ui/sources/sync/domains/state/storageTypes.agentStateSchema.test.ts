import { describe, expect, it } from 'vitest';

import { AgentStateSchema } from '@/sync/domains/state/storageTypes';

describe('AgentStateSchema', () => {
    it('parses JSON strings for backward compatibility', () => {
        const parsed = AgentStateSchema.safeParse(JSON.stringify({ controlledByUser: true }));
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.controlledByUser).toBe(true);
    });

    it('accepts object values', () => {
        const parsed = AgentStateSchema.safeParse({ controlledByUser: true });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.controlledByUser).toBe(true);
    });

    it('retains a permission request occurrence identity from the CLI projection', () => {
        const parsed = AgentStateSchema.parse({
            requests: {
                reused: { tool: 'Write', arguments: { path: '/file' }, createdAt: 10, occurrenceId: 'occurrence-2' },
            },
        });
        expect(parsed.requests?.reused?.occurrenceId).toBe('occurrence-2');
    });
});

