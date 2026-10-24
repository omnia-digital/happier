import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const listToolsMock = vi.fn();
const closeMock = vi.fn();
const stderrResumeMock = vi.fn();
const constructedTransports: Array<{ command: string; stderr?: string }> = [];

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    async connect(transport: { command: string }) {
      return await connectMock(transport);
    }

    async listTools() {
      return await listToolsMock();
    }

    async close() {
      return await closeMock();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    command: string;
    args: string[];
    env: Record<string, string>;
    stderr = { resume: stderrResumeMock };

    constructor(config: { command: string; args?: string[]; env?: Record<string, string>; stderr?: string }) {
      this.command = config.command;
      this.args = config.args ?? [];
      this.env = config.env ?? {};
      constructedTransports.push({ command: this.command, stderr: config.stderr });
    }
  },
}));

describe('listResolvedCustomHappierTools', () => {
  beforeEach(() => {
    connectMock.mockReset();
    listToolsMock.mockReset();
    closeMock.mockReset();
    stderrResumeMock.mockReset();
    constructedTransports.length = 0;
  });

  it('discovers tools beyond the first page and retains their read-only contract', async () => {
    listToolsMock.mockResolvedValueOnce({ tools: [], nextCursor: 'next' }).mockResolvedValueOnce({ tools: [{ name: 'get_issue', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { readOnlyHint: true } }] });
    const { listResolvedCustomHappierTools } = await import('./listResolvedCustomHappierTools');
    const result = await listResolvedCustomHappierTools({ mcpServers: { linear: { command: 'configured' } } });
    expect(result.tools).toEqual([expect.objectContaining({ name: 'get_issue', annotations: { readOnlyHint: true } })]);
  });

  it('skips failed MCP sources and keeps listing remaining tools', async () => {
    const listedSources: string[] = [];

    connectMock.mockImplementation(async (transport: { command: string }) => {
      listedSources.push(transport.command);
      if (transport.command === 'fail-server') {
        throw new Error('Connection closed');
      }
    });

    listToolsMock.mockResolvedValue({
      tools: [{ name: 'get_marker', description: 'Read QA marker', inputSchema: { type: 'object' } }],
    });

    const { listResolvedCustomHappierTools } = await import('./listResolvedCustomHappierTools');

    const result = await listResolvedCustomHappierTools({
      mcpServers: {
        failing: { command: 'fail-server', args: [], env: {} },
        qa_marker_stdio_20260306: { command: 'ok-server', args: [], env: {} },
      },
      processEnv: {},
    });

    expect(listedSources).toEqual(['fail-server', 'ok-server']);
    expect(result.tools).toEqual([
      expect.objectContaining({
        source: 'qa_marker_stdio_20260306',
        name: 'get_marker',
        description: 'Read QA marker',
      }),
    ]);
    expect(result.warnings).toEqual([
      {
        source: 'failing',
        error: 'Connection closed',
      },
    ]);
    expect(constructedTransports).toEqual([
      { command: 'fail-server', stderr: 'pipe' },
      { command: 'ok-server', stderr: 'pipe' },
    ]);
    expect(stderrResumeMock).toHaveBeenCalledTimes(2);
    expect(closeMock).toHaveBeenCalledTimes(2);
  });
});
