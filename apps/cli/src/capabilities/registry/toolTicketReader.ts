import type { Capability } from '../service';
import type { Credentials } from '@/persistence';
import { refreshActiveAccountSettingsFromServer } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import {
  TICKET_READER_CAPABILITY_ID, TicketReaderSourcesRequestSchema, TicketReaderReadRequestSchema,
  type TicketReaderErrorCode,
} from '@happier-dev/protocol';
import { readMcpServersSettingsFromAccountSettings } from '@/mcp/servers/readMcpServersSettingsFromAccountSettings';
import { resolveEffectiveMcpServersForDirectory } from '@/mcp/servers/resolveEffectiveMcpServersForDirectory';
import { resolveCustomHappierToolsContext } from '@/agent/tools/happierTools/customMcp/resolveCustomHappierToolsContext';
import { listResolvedCustomHappierTools } from '@/agent/tools/happierTools/customMcp/listResolvedCustomHappierTools';
import { callResolvedCustomHappierTool } from '@/agent/tools/happierTools/customMcp/callResolvedCustomHappierTool';
import { readTicketFromMcp, ticketReaderErrorCode } from '@/integrations/tickets/readTicketFromMcp';

export type TicketReaderContext = Readonly<{ machineId: string; credentials: Credentials }>;
export function createTicketReaderCapability(context: TicketReaderContext, deps?: Readonly<{
  env?: NodeJS.ProcessEnv;
}>): Capability {
  const env = deps?.env ?? process.env;
  const enabled = () => env.HAPPIER_TICKET_READER_ENABLED === '1';
  const failure = (code: TicketReaderErrorCode) => ({ ok: false as const, error: { code, message: code } });
  return {
    descriptor: { id: TICKET_READER_CAPABILITY_ID, kind: 'tool', title: 'Ticket reader', methods: { sources: { title: 'Configured connections' }, read: { title: 'Read ticket' } } },
    detect: async () => ({ available: enabled() }),
    invoke: async ({ method, params, signal }) => {
      if (!enabled()) return failure('disabled');
      const parsed = method === 'sources' ? TicketReaderSourcesRequestSchema.safeParse(params)
        : method === 'read' ? TicketReaderReadRequestSchema.safeParse(params) : null;
      if (!parsed?.success) return failure('invalid_request');
      try {
        signal?.throwIfAborted();
        // This context belongs to the receiving machine's authenticated Home/account. Never
        // reload another CLI home's current credentials or accept credentials over RPC.
        const loaded = await refreshActiveAccountSettingsFromServer({ credentials: context.credentials, shouldCommit: () => !signal?.aborted });
        signal?.throwIfAborted();
        const accountSettings = loaded.settings;
        const settings = readMcpServersSettingsFromAccountSettings(accountSettings);
        const resolved = resolveEffectiveMcpServersForDirectory({ settings, machineId: context.machineId, directory: parsed.data.directory });
        const sources = Object.values(resolved.serversByName).filter((source) => source.enabled);
        if (method === 'sources') return { ok: true, result: { sources: sources.map((source) => ({ id: source.config.id, title: source.config.title ?? source.config.name })) } };
        const request = TicketReaderReadRequestSchema.parse(parsed.data);
        const selected = sources.find((source) => source.config.id === request.mcpServerId);
        if (!selected) return failure('unconfigured');
        const materialized = await resolveCustomHappierToolsContext({
          credentials: context.credentials, accountSettings, machineId: context.machineId,
          directory: request.directory, processEnv: env, serverIds: [selected.config.id],
        });
        try {
          signal?.throwIfAborted();
          const listed = await listResolvedCustomHappierTools({ mcpServers: materialized.mcpServers, processEnv: env, signal });
          signal?.throwIfAborted();
          if (listed.warnings.length) throw new Error(ticketReaderErrorCode(listed.warnings[0].error));
          const result = await readTicketFromMcp({ url: request.url, tools: listed.tools, now: Date.now, call: async (toolName, args) => {
            signal?.throwIfAborted();
            const called = await callResolvedCustomHappierTool({ source: selected.config.name, toolName, args, mcpServers: materialized.mcpServers, processEnv: env, signal });
            signal?.throwIfAborted();
            if (!called.ok) throw new Error(ticketReaderErrorCode(called.error));
            return called.result;
          } });
          signal?.throwIfAborted();
          return { ok: true, result };
        } finally { materialized.cleanup(); }
      } catch (error) { return failure(signal?.aborted ? 'cancelled' : ticketReaderErrorCode(error)); }
    },
  };
}
