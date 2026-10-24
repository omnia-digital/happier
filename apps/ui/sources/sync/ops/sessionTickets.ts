import { TICKET_READER_CAPABILITY_ID, SessionTicketSnapshotV1Schema, TicketReaderSourcesResponseSchema, TicketReaderErrorCodeSchema, type SessionTicketAssociationV1 } from '@happier-dev/protocol';
import { machineCapabilitiesDetect, machineCapabilitiesInvoke } from './capabilities';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

export async function listSessionTicketSources(scope: ServerAccountScope, machineId: string, directory: string) {
    const detected = await machineCapabilitiesDetect(machineId, { requests: [{ id: TICKET_READER_CAPABILITY_ID }] }, scope);
    if (!detected.supported) throw new Error(detected.reason === 'not-supported' ? 'unsupported' : 'offline');
    const capability = detected.response.results[TICKET_READER_CAPABILITY_ID];
    if (!capability?.ok) throw new Error(capability ? 'offline' : 'unsupported');
    if (!(capability.data && typeof capability.data === 'object' && 'available' in capability.data && capability.data.available === true)) throw new Error('disabled');
    return TicketReaderSourcesResponseSchema.parse(await invokeTicketReader(scope, machineId, 'sources', { directory })).sources;
}

async function invokeTicketReader(scope: ServerAccountScope, machineId: string, method: 'read' | 'sources', params: Record<string, unknown>) {
    const result = await machineCapabilitiesInvoke(machineId, { id: TICKET_READER_CAPABILITY_ID, method, params }, scope);
    if (!result.supported) throw new Error(result.reason === 'not-supported' ? 'unsupported' : 'offline');
    if (!result.response.ok) {
        const code = TicketReaderErrorCodeSchema.safeParse(result.response.error.code);
        throw new Error(code.success ? code.data : 'provider_error');
    }
    return result.response.result;
}

export async function readSessionTicket(scope: ServerAccountScope, reader: SessionTicketAssociationV1['reader'], url: string) {
    return SessionTicketSnapshotV1Schema.parse(await invokeTicketReader(scope, reader.machineId, 'read', { directory: reader.directory, mcpServerId: reader.mcpServerId, url }));
}
