import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { ChatImageConfirmError, confirmChatImageUpload } from './imagePull';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./supabaseClient', () => ({
  getSupabaseUrl: () => 'https://chat-storage.example',
  getSupabaseBrowserClient: () => ({ functions: { invoke: mocks.invoke } })
}));

const BLOB_ID = '12345678-abcd-40ef-9234-567890abcdef';
const TX_HASH = `0x${'a'.repeat(64)}`;
const TOKEN = 'b'.repeat(64);

const httpError = (status: number, answer: string) =>
  new FunctionsHttpError(new Response(JSON.stringify({ error: answer }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  }));

const confirmFailure = async (): Promise<ChatImageConfirmError> => {
  const error = await confirmChatImageUpload(BLOB_ID, TX_HASH, TOKEN).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(ChatImageConfirmError);
  return error as ChatImageConfirmError;
};

describe('confirmChatImageUpload failure classification', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('resolves when the server confirms retention', async () => {
    mocks.invoke.mockResolvedValue({ data: { status: 'confirmed' }, error: null });
    await expect(confirmChatImageUpload(BLOB_ID, TX_HASH, TOKEN)).resolves.toBeUndefined();
  });

  it('marks the not-yet-confirmed receipt answer as retryable', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(400, 'Image message transaction is not confirmed.') });
    expect(await confirmFailure()).toMatchObject({ retryable: true, reason: 'not-confirmed', status: 400 });
  });

  it.each([429, 503])('marks a busy %s answer as retryable', async (status) => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(status, 'Image confirmation RPC is busy.') });
    expect(await confirmFailure()).toMatchObject({ retryable: true, reason: 'busy', status });
  });

  it('marks a network failure as retryable', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
    expect(await confirmFailure()).toMatchObject({ retryable: true, reason: 'network' });
  });

  it.each([
    [403, 'Invalid image confirmation token.'],
    [400, 'Image message transaction was sent by a different wallet.'],
    [410, 'Pending image upload expired before confirmation.'],
    [500, 'Failed to confirm image upload.']
  ])('stops on a final %s answer', async (status, answer) => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(status, answer) });
    expect(await confirmFailure()).toMatchObject({ retryable: false, reason: 'rejected', status });
  });
});
