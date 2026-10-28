import type { ConversationPreferenceState } from '../../../lib/appShared';
import { isWalletAddress } from '../../../lib/appShared';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import type { DirectChatV2SessionController } from '../../../lib/directChatV2Session';

type UseConversationPreferenceActionsArgs = {
  directChatV2Session: DirectChatV2SessionController | null;
  setError: (next: string) => void;
  walletAddress: string;
};

/** Contact aliases and hidden state are private Direct Chat V2 settings, never maintenance messages. */
export default function useConversationPreferenceActions({
  directChatV2Session,
  setError,
  walletAddress
}: UseConversationPreferenceActionsArgs) {
  const syncConversationStateFromInput = async (
    contactAddress: string,
    state: ConversationPreferenceState,
    _visibleNotice = ''
  ): Promise<boolean> => {
    const normalizedAddress = contactAddress.trim();
    if (
      !directChatV2Session ||
      !isWalletAddress(normalizedAddress) ||
      normalizedAddress.toLowerCase() === walletAddress.trim().toLowerCase()
    ) {
      setError('Direct Chat V2 contact settings are unavailable. No legacy maintenance message was sent.');
      return false;
    }
    try {
      const current = await directChatV2Session.readContactSettings(normalizedAddress);
      await directChatV2Session.setContactSettings(normalizedAddress, {
        savedName: current.settings.savedName,
        hidden: Boolean(state.hidden ?? state.muted)
      });
      return true;
    } catch (syncError) {
      const message = getProviderErrorMessage(syncError, 'Failed to save private contact settings.');
      setError(`Private contact settings were not saved: ${message}`);
      return false;
    }
  };

  return { syncConversationStateFromInput };
}
