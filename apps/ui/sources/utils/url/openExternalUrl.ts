import { Linking, Platform } from 'react-native';
import { invokeTauri, isTauriDesktop } from '@/utils/platform/tauri';
import { parseSessionTicketUrl } from '@happier-dev/protocol';

const SAFE_EXTERNAL_URL_SCHEME_PATTERN = /^(https?:\/\/|mailto:)/i;

export async function openExternalUrl(
  url: string,
  opts?: Readonly<{ platformOS?: string }>,
): Promise<boolean> {
  const normalized = String(url ?? '').trim();
  const linearWebUrl = normalized.startsWith('linear://linear.app/') ? normalized.replace(/^linear:/, 'https:') : null;
  const isExactLinearTicket = linearWebUrl !== null && parseSessionTicketUrl(linearWebUrl)?.url === linearWebUrl;
  if (!SAFE_EXTERNAL_URL_SCHEME_PATTERN.test(normalized) && !isExactLinearTicket) return false;

  const platformOS = String(opts?.platformOS ?? Platform.OS ?? '').toLowerCase();
  if (platformOS === 'web' && isTauriDesktop()) {
    try {
      await invokeTauri('plugin:opener|open_url', { url: normalized });
      return true;
    } catch {
      console.error('Tauri could not open an external URL');
      return false;
    }
  }
  if (platformOS === 'web') {
    try {
      const openFn = (globalThis as unknown as { open?: unknown }).open;
      if (typeof openFn === 'function') {
        (openFn as (url: string, target?: string, features?: string) => unknown)(
          normalized,
          '_blank',
          'noopener,noreferrer',
        );
        return true;
      }
    } catch {
      // fall through
    }
  }

  try {
    await Linking.openURL(normalized);
    return true;
  } catch {
    return false;
  }
}
