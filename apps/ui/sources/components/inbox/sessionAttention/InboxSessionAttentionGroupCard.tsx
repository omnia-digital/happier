import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { Session } from '@/sync/domains/state/storageTypes';
import type { PendingPermissionRequest } from '@/utils/sessions/sessionUtils';

import { PermissionPromptCard } from '@/components/tools/shell/permissions/PermissionPromptCard';
import { UserActionPromptCard } from '@/components/tools/shell/userActions/UserActionPromptCard';
import { deriveTranscriptInteractionFromSession } from '@/utils/sessions/deriveTranscriptInteraction';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { InboxSessionAttentionHeader } from './InboxSessionAttentionHeader';
import type { SessionListIdentityDisplay } from '@/components/sessions/shell/SessionListIdentity';

export const InboxSessionAttentionGroupCard = React.memo(function InboxSessionAttentionGroupCard(props: Readonly<{
    session: Session;
    serverId: string | null;
    permissionRequests: readonly PendingPermissionRequest[];
    userActionRequests: readonly PendingPermissionRequest[];
    machineLabel: string | null;
    machineId: string | null;
    workspaceName: string | null;
    statusLabel: string;
    identityDisplay: SessionListIdentityDisplay;
    onOpenSession: () => void;
    showDivider?: boolean;
}>) {
    const transcriptInteraction = React.useMemo(() => {
        return deriveTranscriptInteractionFromSession({
            accessLevel: props.session.accessLevel,
            canApprovePermissions: props.session.canApprovePermissions,
            active: props.session.active,
            presence: props.session.presence,
        });
    }, [props.session.accessLevel, props.session.canApprovePermissions, props.session.active, props.session.presence]);

    if (
        transcriptInteraction.permissionDisabledReason === 'inactive' &&
        (props.permissionRequests.length > 0 || props.userActionRequests.length > 0)
    ) {
        return null;
    }

    return (
        <View testID={`inbox.session_attention.${props.serverId ?? 'local'}.${props.session.id}`}>
            <InboxSessionAttentionHeader
                sessionTitle={getSessionName(props.session)}
                machineLabel={props.machineLabel}
                machineId={props.machineId}
                serverId={props.serverId}
                workspaceLabel={props.workspaceName}
                statusLabel={props.statusLabel}
                session={props.session}
                identityDisplay={props.identityDisplay}
                onOpenSession={props.onOpenSession}
            />

            <View style={styles.items}>
                {props.permissionRequests.map((request) => (
                    <PermissionPromptCard
                        key={request.id}
                        request={request}
                        location={null}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        canApprovePermissions={transcriptInteraction.canApprovePermissions}
                        disabledReason={transcriptInteraction.permissionDisabledReason}
                    />
                ))}

                {props.userActionRequests.map((request) => (
                    <UserActionPromptCard
                        key={request.id}
                        request={request}
                        location={null}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        canApprovePermissions={transcriptInteraction.canApprovePermissions}
                        disabledReason={transcriptInteraction.permissionDisabledReason}
                    />
                ))}
            </View>
            {props.showDivider ? <View style={styles.divider} /> : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    items: {
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    divider: {
        height: 1,
        marginLeft: 16,
        backgroundColor: theme.colors.border.default,
    },
}));
