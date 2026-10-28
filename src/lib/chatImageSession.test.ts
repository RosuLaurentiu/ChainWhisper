import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock('./supabaseClient', () => ({
  getSupabaseBrowserClient: () => ({ functions: { invoke: supabaseMocks.invoke } }),
  getSupabaseUrl: () => 'https://example.supabase.co'
}));

import { clearChatImageSessionTokens, getChatImageSessionToken } from './chatImageSession';

const OWNER = '0x1111111111111111111111111111111111111111';

describe('chat image wallet session cache', () => {
  beforeEach(() => {
    clearChatImageSessionTokens();
    vi.clearAllMocks();
    supabaseMocks.invoke.mockImplementation(async (_name: string, options: {
      body: { expiresAt: number };
    }) => ({
      data: { token: 'wallet-scoped-session-token', expiresAt: options.body.expiresAt },
      error: null
    }));
  });

  it('asks for one wallet signature and reuses only the in-memory owner-scoped token', async () => {
    const signAuthorization = vi.fn(async (_message: string) => `0x${'ab'.repeat(65)}`);
    const assertCurrent = vi.fn();
    const request = {
      assertCurrent,
      chainId: 2_632_500n,
      ownerAddress: OWNER,
      signAuthorization
    };

    await expect(getChatImageSessionToken(request)).resolves.toBe('wallet-scoped-session-token');
    await expect(getChatImageSessionToken(request)).resolves.toBe('wallet-scoped-session-token');

    expect(signAuthorization).toHaveBeenCalledOnce();
    expect(signAuthorization.mock.calls[0]?.[0]).toContain(
      'ChainWhisper Chat Image Upload Session\nversion:1'
    );
    expect(supabaseMocks.invoke).toHaveBeenCalledOnce();
    expect(supabaseMocks.invoke).toHaveBeenCalledWith('chat-image-session', expect.objectContaining({
      body: expect.objectContaining({
        chainId: '0x282b34',
        ownerAddress: OWNER
      })
    }));
    expect(assertCurrent).toHaveBeenCalled();
  });

  it('does not return a cached bearer token after the captured wallet scope expires', async () => {
    let current = true;
    const request = {
      assertCurrent: () => {
        if (!current) throw new Error('wallet session changed');
      },
      chainId: 2_632_500n,
      ownerAddress: OWNER,
      signAuthorization: vi.fn(async (_message: string) => `0x${'cd'.repeat(65)}`)
    };
    await getChatImageSessionToken(request);
    current = false;

    await expect(getChatImageSessionToken(request)).rejects.toThrow('wallet session changed');
    expect(supabaseMocks.invoke).toHaveBeenCalledOnce();
  });
});
