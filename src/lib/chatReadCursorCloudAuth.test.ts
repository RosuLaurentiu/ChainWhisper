import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  CHAT_READ_CURSOR_WEB3_STATEMENT,
  authorizeChatReadCursorCloudSession,
  resolveChatReadCursorCloudSession,
  restoreChatReadCursorCloudSession,
  signOutChatReadCursorCloudSession
} from './chatReadCursorCloudAuth';

const OWNER = '0x1000000000000000000000000000000000000001';
const OTHER = '0x2000000000000000000000000000000000000002';
const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

const user = (addresses: readonly string[] = [OWNER]): User => ({
  id: USER_ID,
  app_metadata: {},
  aud: 'authenticated',
  created_at: '2026-08-13T00:00:00.000Z',
  identities: addresses.map((address, index) => ({
    id: address,
    identity_id: `identity-${index}`,
    user_id: USER_ID,
    provider: 'web3',
    identity_data: { address }
  })),
  user_metadata: {}
});

const client = ({
  currentUser = user(),
  restored = true,
  signedInUser = currentUser
}: {
  currentUser?: User;
  restored?: boolean;
  signedInUser?: User;
} = {}) => {
  const signInWithWeb3 = vi.fn(async () => ({
    data: { session: { access_token: 'signed' }, user: signedInUser },
    error: null
  }));
  const signOut = vi.fn(async () => ({ error: null }));
  const value = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: restored ? { access_token: 'restored' } : null },
        error: null
      })),
      getUser: vi.fn(async () => ({ data: { user: currentUser }, error: null })),
      signInWithWeb3,
      signOut
    }
  } as unknown as SupabaseClient;
  return { value, signInWithWeb3, signOut };
};

describe('chatReadCursorCloudAuth', () => {
  it('restores an exact single-wallet Web3 session without a new signature', async () => {
    const selected = client();
    const assertCurrent = vi.fn();
    const session = await restoreChatReadCursorCloudSession({
      assertCurrent,
      client: selected.value,
      ownerAddress: OWNER
    });

    expect(session).not.toBeNull();
    expect(resolveChatReadCursorCloudSession(session!).userId).toBe(USER_ID);
    expect(resolveChatReadCursorCloudSession(session!).ownerAddress).toBe(OWNER);
    expect(selected.signInWithWeb3).not.toHaveBeenCalled();
    expect(assertCurrent).toHaveBeenCalledTimes(2);
  });

  it('restores the server Ethereum subject without a top-level address field', async () => {
    const currentUser = user();
    currentUser.identities![0].id = `web3:ethereum:${OWNER}`;
    currentUser.identities![0].identity_data = {
      sub: `web3:ethereum:${OWNER}`,
      custom_claims: { address: OWNER, chain: 'ethereum' }
    };
    const selected = client({ currentUser });
    const session = await restoreChatReadCursorCloudSession({ assertCurrent: vi.fn(), client: selected.value, ownerAddress: OWNER });
    expect(session).not.toBeNull();
    expect(resolveChatReadCursorCloudSession(session!).ownerAddress).toBe(OWNER);
    expect(selected.signOut).not.toHaveBeenCalled();
  });

  it('does not treat another Web3 namespace as an Ethereum wallet', async () => {
    const currentUser = user();
    currentUser.identities![0].id = `web3:solana:${OWNER}`;
    currentUser.identities![0].identity_data = { address: OWNER };
    const selected = client({ currentUser });
    await expect(restoreChatReadCursorCloudSession({ assertCurrent: vi.fn(), client: selected.value, ownerAddress: OWNER })).resolves.toBeNull();
    expect(selected.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('rejects linked server subjects for two different Ethereum wallets', async () => {
    const currentUser = user([OWNER, OTHER]);
    for (const identity of currentUser.identities!) {
      identity.id = `web3:ethereum:${identity.id}`;
      identity.identity_data = {};
    }
    const selected = client({ currentUser });
    await expect(restoreChatReadCursorCloudSession({ assertCurrent: vi.fn(), client: selected.value, ownerAddress: OWNER })).resolves.toBeNull();
  });

  it('cannot bind a session from editable user metadata', async () => {
    const currentUser = user([]);
    currentUser.user_metadata = { address: OWNER, sub: `web3:ethereum:${OWNER}` };
    const selected = client({ currentUser });
    await expect(restoreChatReadCursorCloudSession({ assertCurrent: vi.fn(), client: selected.value, ownerAddress: OWNER })).resolves.toBeNull();
  });

  it('uses exactly one explicit EIP-4361 sign-in when this device has no session', async () => {
    const selected = client({ restored: false });
    const request = vi.fn();
    const session = await authorizeChatReadCursorCloudSession({
      assertCurrent: vi.fn(),
      client: selected.value,
      ownerAddress: OWNER,
      wallet: { request }
    });

    expect(resolveChatReadCursorCloudSession(session).ownerAddress).toBe(OWNER);
    expect(selected.signInWithWeb3).toHaveBeenCalledTimes(1);
    expect(selected.signInWithWeb3).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'ethereum',
      statement: CHAT_READ_CURSOR_WEB3_STATEMENT,
      wallet: expect.objectContaining({ address: OWNER })
    }));
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects another wallet and linked multi-wallet identities', async () => {
    const wrong = client({ currentUser: user([OTHER]) });
    await expect(restoreChatReadCursorCloudSession({
      assertCurrent: vi.fn(),
      client: wrong.value,
      ownerAddress: OWNER
    })).resolves.toBeNull();
    expect(wrong.signOut).toHaveBeenCalledWith({ scope: 'local' });

    const linked = client({ currentUser: user([OWNER, OTHER]) });
    await expect(restoreChatReadCursorCloudSession({
      assertCurrent: vi.fn(),
      client: linked.value,
      ownerAddress: OWNER
    })).resolves.toBeNull();
  });

  it('fails if the wallet lease changes during authorization', async () => {
    const selected = client({ restored: false });
    let checks = 0;
    await expect(authorizeChatReadCursorCloudSession({
      assertCurrent: () => {
        checks += 1;
        if (checks === 4) throw new Error('wallet session changed');
      },
      client: selected.value,
      ownerAddress: OWNER,
      wallet: { request: vi.fn() }
    })).rejects.toThrow('wallet session changed');
  });

  it('signs out only through an opaque authenticated session', async () => {
    const selected = client();
    const session = await restoreChatReadCursorCloudSession({
      assertCurrent: vi.fn(),
      client: selected.value,
      ownerAddress: OWNER
    });
    await signOutChatReadCursorCloudSession(session!);
    expect(selected.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(() => resolveChatReadCursorCloudSession({} as never)).toThrow(/not authenticated/i);
  });
});
