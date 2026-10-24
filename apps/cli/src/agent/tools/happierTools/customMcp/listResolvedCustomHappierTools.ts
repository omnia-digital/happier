import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { McpServerConfig } from '@/agent';
import { createCustomMcpClientTransport } from './createCustomMcpClientTransport';

export type ResolvedCustomHappierTool = Readonly<{
  source: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Readonly<{ readOnlyHint?: boolean }>;
}>;

export type ResolvedCustomHappierToolWarning = Readonly<{
  source: string;
  error: string;
}>;

async function listServerTools(serverName: string, config: McpServerConfig, baseEnv: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<ResolvedCustomHappierTool[]> {
  signal?.throwIfAborted();
  const transport = createCustomMcpClientTransport(config, baseEnv);
  const client = new Client({ name: 'happier-tools-list', version: '1.0.0' }, { capabilities: {} });
  const onAbort = () => { void client.close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await client.connect(transport);
    const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const listed = await client.listTools(cursor ? { cursor } : undefined, { signal });
      tools.push(...listed.tools);
      cursor = listed.nextCursor;
    } while (cursor);
    return tools
      .filter((tool: any) => typeof tool?.name === 'string')
      .map((tool: any) => ({
        source: serverName,
        name: tool.name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      }));
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await client.close().catch(() => {});
  }
}

export async function listResolvedCustomHappierTools(params: Readonly<{
  mcpServers: Record<string, McpServerConfig>;
  processEnv?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  tools: ReadonlyArray<ResolvedCustomHappierTool>;
  warnings: ReadonlyArray<ResolvedCustomHappierToolWarning>;
}>> {
  const tools: ResolvedCustomHappierTool[] = [];
  const warnings: ResolvedCustomHappierToolWarning[] = [];
  for (const [serverName, config] of Object.entries(params.mcpServers)) {
    if (serverName === 'happier') continue;
    try {
      tools.push(...await listServerTools(serverName, config, params.processEnv ?? process.env, params.signal));
    } catch (error) {
      warnings.push({
        source: serverName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { tools, warnings };
}
