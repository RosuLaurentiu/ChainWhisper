import { describe, expect, it } from 'vitest';
import {
  selectLegacyUnreadTargets,
  shouldUseLegacyConversationReadState
} from './useConversationReadStateActions';

describe('conversation read-state policy', () => {
  it('does not let route timestamps acknowledge V2 messages', () => {
    expect(shouldUseLegacyConversationReadState(true, true)).toBe(false);
    expect(shouldUseLegacyConversationReadState(true, false)).toBe(true);
    expect(shouldUseLegacyConversationReadState(false, false)).toBe(false);
  });

  it('preserves V2 unread maps when legacy Mark All runs', () => {
    const unreadContacts = {
      '0x0000000000000000000000000000000000000001': true
    };
    const unreadGroups = { '7': true };

    expect(selectLegacyUnreadTargets({
      directChatV2Enabled: true,
      groupChatV2Enabled: true,
      unreadContacts,
      unreadGroups
    })).toEqual({ addresses: [], groupKeys: [] });

    expect(selectLegacyUnreadTargets({
      directChatV2Enabled: false,
      groupChatV2Enabled: false,
      unreadContacts,
      unreadGroups
    })).toEqual({
      addresses: ['0x0000000000000000000000000000000000000001'],
      groupKeys: ['7']
    });
  });
});
