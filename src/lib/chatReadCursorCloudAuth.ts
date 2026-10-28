import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getAddress } from '@coti-io/coti-ethers';
import { getSupabaseWeb3AuthClient } from './supabaseClient';

export const CHAT_READ_CURSOR_WEB3_STATEMENT =
  'Enable optional ChainWhisper cross-device read-status sync. No messages or encryption keys are stored.';

type Eip1193Provider = Readonly<{
  request: (input: {
    method: string;
    params?: unknown[] | object;
  }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}>;

export type ChatReadCursorCloudSession = Readonly<{
  readonly __chatReadCursorCloudSession: unique symbol;
}>;

export type ChatReadCursorCloudSessionBinding = Readonly<{
  assertCurrent: () => void | Promise<void>;
  client: SupabaseClient;
  ownerAddress: string;
  userId: string;
}>;

const SESSION_BINDINGS = new WeakMap<object, ChatReadCursorCloudSessionBinding>();
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const identityAddresses = (user: User): readonly string[] => {
  const addresses = new Set<string>();
  for (const identity of user.identities ?? []) {
    const provider = identity.provider.trim().toLowerCase();
    if (provider !== 'web3' && provider !== 'ethereum') continue;
    const subjectAddress = /^web3:ethereum:(0x[0-9a-fA-F]{40})$/u.exec(identity.id)?.[1];
    if (identity.id.startsWith('web3:') && !subjectAddress) continue;
    const candidates = [subjectAddress, identity.id, identity.identity_data?.address];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !ADDRESS.test(candidate.trim())) continue;
      addresses.add(getAddress(candidate.trim()).toLowerCase());
    }
  }
  return [...addresses];
};

const requireWalletUser = (user: User, expectedOwnerAddress: string): string => {
  const ownerAddress = getAddress(expectedOwnerAddress.trim());
  const addresses = identityAddresses(user);
  if (addresses.length !== 1 || addresses[0] !== ownerAddress.toLowerCase()) {
    throw new Error('Supabase Web3 session is not bound only to the selected wallet.');
  }
  if (!UUID.test(user.id)) {
    throw new Error('Supabase Web3 session user ID is malformed.');
  }
  return user.id.toLowerCase();
};

const mintSession = ({
  assertCurrent,
  client,
  ownerAddress,
  user
}: {
  assertCurrent: () => void | Promise<void>;
  client: SupabaseClient;
  ownerAddress: string;
  user: User;
}): ChatReadCursorCloudSession => {
  const selectedOwner = getAddress(ownerAddress.trim());
  const session = Object.freeze({}) as ChatReadCursorCloudSession;
  SESSION_BINDINGS.set(session, Object.freeze({
    assertCurrent,
    client,
    ownerAddress: selectedOwner,
    userId: requireWalletUser(user, selectedOwner)
  }));
  return session;
};

export const resolveChatReadCursorCloudSession = (
  session: ChatReadCursorCloudSession
): ChatReadCursorCloudSessionBinding => {
  const binding = SESSION_BINDINGS.get(session);
  if (!binding) throw new Error('Cross-device read-status session is not authenticated.');
  return binding;
};

const restoreUser = async (
  client: SupabaseClient,
  ownerAddress: string
): Promise<User | null> => {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error('Unable to restore the cross-device read-status session.');
  if (!sessionData.session) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    await client.auth.signOut({ scope: 'local' });
    return null;
  }
  try {
    requireWalletUser(data.user, ownerAddress);
    return data.user;
  } catch {
    await client.auth.signOut({ scope: 'local' });
    return null;
  }
};

/** Restores an already-authorized device without opening a wallet prompt. */
export const restoreChatReadCursorCloudSession = async ({
  assertCurrent,
  client = getSupabaseWeb3AuthClient(),
  ownerAddress
}: {
  assertCurrent: () => void | Promise<void>;
  client?: SupabaseClient;
  ownerAddress: string;
}): Promise<ChatReadCursorCloudSession | null> => {
  await assertCurrent();
  const user = await restoreUser(client, ownerAddress);
  await assertCurrent();
  return user ? mintSession({ assertCurrent, client, ownerAddress, user }) : null;
};

/**
 * Explicitly opts this device into cursor sync. A valid persisted Web3 session
 * is reused; otherwise Supabase EIP-4361 authentication opens one signature.
 */
export const authorizeChatReadCursorCloudSession = async ({
  assertCurrent,
  client = getSupabaseWeb3AuthClient(),
  ownerAddress,
  wallet
}: {
  assertCurrent: () => void | Promise<void>;
  client?: SupabaseClient;
  ownerAddress: string;
  wallet: Eip1193Provider;
}): Promise<ChatReadCursorCloudSession> => {
  const restored = await restoreChatReadCursorCloudSession({
    assertCurrent,
    client,
    ownerAddress
  });
  if (restored) return restored;

  await assertCurrent();
  const selectedOwner = getAddress(ownerAddress.trim());
  const { data, error } = await client.auth.signInWithWeb3({
    chain: 'ethereum',
    statement: CHAT_READ_CURSOR_WEB3_STATEMENT,
    wallet: {
      address: selectedOwner,
      request: (input) => wallet.request({
        method: input.method,
        params: input.params as unknown[] | object | undefined
      }),
      on: (event, listener) => { wallet.on?.(event, listener as (...args: unknown[]) => void); },
      removeListener: (event, listener) => {
        wallet.removeListener?.(event, listener as (...args: unknown[]) => void);
      }
    }
  });
  await assertCurrent();
  if (error || !data.session || !data.user) {
    throw new Error('Wallet authentication for cross-device read-status sync failed.');
  }
  return mintSession({ assertCurrent, client, ownerAddress, user: data.user });
};

export const signOutChatReadCursorCloudSession = async (
  session: ChatReadCursorCloudSession
): Promise<void> => {
  const binding = resolveChatReadCursorCloudSession(session);
  await binding.assertCurrent();
  const { error } = await binding.client.auth.signOut({ scope: 'local' });
  if (error) throw new Error('Unable to sign out of cross-device read-status sync.');
};
