import { defineSettingDefinitions } from '@happier-dev/protocol';
import { z } from 'zod';

export const ACCOUNT_SESSION_ARCHIVE_SETTING_DEFINITIONS = defineSettingDefinitions({
    cleanupLocalResourcesOnArchive: {
        schema: z.boolean(),
        default: false,
        description: 'Request conservative local machine resource cleanup after a confirmed session archive',
        storageScope: 'account',
    },
    autoArchiveAfterLinkedPullRequestsMerge: {
        schema: z.boolean(),
        default: false,
        description: 'Archive inactive sessions when every linked pull request is freshly verified merged',
        storageScope: 'account',
    },
});
