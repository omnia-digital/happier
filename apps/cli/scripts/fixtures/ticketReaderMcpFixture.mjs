// Isolated integration-test peer. No network, credentials, or provider writes.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
const input = createInterface({ input: process.stdin });
const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (!('id' in request)) return;
  if (request.method === 'initialize') return send(request.id, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'ticket-reader-fixture', version: '1' } });
  if (request.method === 'tools/list') return send(request.id, { tools: [{ name: 'get_issue', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] });
  if (request.method === 'tools/call') {
    if (process.env.TICKET_FIXTURE_TOKEN !== 'synthetic-read-token') return send(request.id, { isError: true, content: [{ type: 'text', text: '401 invalid credential' }] });
    if (request.params.name !== 'get_issue') return send(request.id, { isError: true, content: [{ type: 'text', text: 'unexpected non-read tool' }] });
    const state = process.env.TICKET_FIXTURE_STATE ? JSON.parse(readFileSync(process.env.TICKET_FIXTURE_STATE, 'utf8')) : {};
    if (state.error) return send(request.id, { isError: true, content: [{ type: 'text', text: state.error }] });
    return send(request.id, { content: [{ type: 'text', text: JSON.stringify({ id: request.params.arguments.id, uuid: process.env.TICKET_FIXTURE_STATE ? `fixture-${request.params.arguments.id}` : 'fixture-issue-id', title: 'Fixture ticket', url: `https://linear.app/fixture/issue/${request.params.arguments.id}`, status: state.status ?? 'Q/A - Dev' }) }] });
  }
  send(request.id, {});
});
