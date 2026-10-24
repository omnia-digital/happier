import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { McpServerConfig } from '@/agent';
import { callMcpToolWithResolvedTimeout } from '@/mcp/mcpToolCallRequestOptions';
import { createCustomMcpClientTransport } from './createCustomMcpClientTransport';

export async function callResolvedCustomHappierTool(params: Readonly<{
  source: string;
  toolName: string;
  args: unknown;
  mcpServers: Record<string, McpServerConfig>;
  processEnv?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}>): Promise<{ ok: true; result: unknown } | { ok: false; errorCode: string; error: string }> {
  const config = params.mcpServers[params.source];
  if (!config) {
    return { ok: false, errorCode: 'server_not_found', error: `Unknown MCP server source: ${params.source}` };
  }

  if (params.signal?.aborted) return { ok: false, errorCode: 'cancelled', error: 'cancelled' };
  const transport = createCustomMcpClientTransport(config, params.processEnv ?? process.env);
  const client = new Client({ name: 'happier-tools-call', version: '1.0.0' }, { capabilities: {} });
  const onAbort = () => { void client.close().catch(() => {}); };
  params.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await client.connect(transport);
    params.signal?.throwIfAborted();
    const result = await callMcpToolWithResolvedTimeout({
      client,
      toolName: params.toolName,
      args: params.args,
      signal: params.signal,
    });
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      errorCode: 'tool_call_failed',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    params.signal?.removeEventListener('abort', onAbort);
    await client.close().catch(() => {});
  }
}
