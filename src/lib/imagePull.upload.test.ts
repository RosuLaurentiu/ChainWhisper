import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createEncryptedImageTagFromFile, MAX_IMAGE_PLAINTEXT_BYTES, MAX_IMAGE_ENCRYPTED_BYTES, parseImageTag } from './imagePull';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./supabaseClient', () => ({ getSupabaseUrl: () => 'https://chat-storage.example', getSupabaseBrowserClient: () => ({ functions: { invoke: mocks.invoke } }) }));
const owner = '0x1111111111111111111111111111111111111111';
const target = '0x2222222222222222222222222222222222222222';
const plaintext = 'private-image-content-that-must-not-reach-storage';
const file = () => new File([plaintext], 'private-filename.png', { type: 'image/png' });
const session = (protocol: 'direct-v2' | 'group-v2' = 'direct-v2') => ({ mode: 'session' as const, protocol, token: vi.fn(async () => 'test-session-token') });
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
beforeEach(() => { mocks.invoke.mockReset(); mocks.invoke.mockResolvedValue({ data: {}, error: null }); });
afterEach(() => vi.restoreAllMocks());

describe('actual encrypted image upload boundary; Supabase invoke mocked', () => {
  it.each([['direct', target, 'direct-v2'], ['group', '123', 'group-v2']] as const)('uploads authenticated ciphertext with bounded metadata for %s', async (kind, conversation, protocol) => {
    const result = await createEncryptedImageTagFromFile(file(), kind, owner, conversation, session(protocol));
    const parsed = parseImageTag(result.imageTag)!;
    expect(parsed).not.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const [endpoint, request] = mocks.invoke.mock.calls[0] as [string, { body: Blob; headers: Record<string, string> }];
    expect(endpoint).toBe('chat-image-upload'); expect(request.body.type).toBe('application/octet-stream');
    // Supabase adds the HTTP Content-Type after the mocked invoke boundary.
    const wireFetch = vi.fn<typeof fetch>(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    const transport = createClient('https://chat-storage.example', 'test-publishable-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: wireFetch }
    });
    const transportResult = await transport.functions.invoke(endpoint, request);
    expect(transportResult.error).toBeNull();
    expect(wireFetch).toHaveBeenCalledOnce();
    expect(new Headers(wireFetch.mock.calls[0][1]?.headers).get('content-type')).toBe('application/octet-stream');
    expect(wireFetch.mock.calls[0][1]?.body).toBe(request.body);
    const encrypted = await request.body.arrayBuffer();
    expect(encrypted.byteLength).toBe(new TextEncoder().encode(plaintext).byteLength + 16);
    expect(encrypted.byteLength).toBeLessThanOrEqual(MAX_IMAGE_ENCRYPTED_BYTES);
    expect(new TextDecoder().decode(encrypted)).not.toContain(plaintext);
    const key = await crypto.subtle.importKey('raw', bytes(parsed.keyHex), 'AES-GCM', false, ['decrypt']);
    const recovered = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(parsed.ivHex) }, key, encrypted);
    expect(new TextDecoder().decode(recovered)).toBe(plaintext);
    const ciphertextHash = hex(await crypto.subtle.digest('SHA-256', encrypted));
    const confirmationHash = hex(await crypto.subtle.digest('SHA-256', bytes(result.confirmationToken)));
    expect(request.headers).toMatchObject({ 'x-chat-image-blob-id': result.blobId,
      'x-chat-image-ciphertext-sha256': ciphertextHash, 'x-chat-image-confirmation-token-hash': confirmationHash,
      'x-chat-image-kind': kind, 'x-chat-image-owner': owner, 'x-chat-image-target': conversation,
      'x-chat-image-protocol': protocol, 'x-chat-image-mime': 'image/png', 'x-chat-image-session-token': 'test-session-token',
      'x-chat-image-plaintext-size': String(parsed.sizeBytes), 'x-chat-image-encrypted-size': String(encrypted.byteLength) });
    expect(Number(request.headers['x-chat-image-expires-at']) - Number(request.headers['x-chat-image-issued-at'])).toBe(300);
    const metadata = JSON.stringify(request.headers);
    for (const secret of [plaintext, 'private-filename.png', parsed.keyHex, parsed.ivHex, result.confirmationToken, result.imageTag]) expect(metadata).not.toContain(secret);
    const corrupted = new Uint8Array(encrypted.slice(0)); corrupted[0] ^= 1;
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(parsed.ivHex) }, key, corrupted)).rejects.toThrow();
  });
  it('binds signature authorization to the actual ciphertext and the uploaded metadata', async () => {
    const sign = vi.fn(async (_message: string) => `0x${'ab'.repeat(65)}`);
    const result = await createEncryptedImageTagFromFile(file(), 'direct', owner, target, { mode: 'signature', sign });
    const request = mocks.invoke.mock.calls[0][1] as { body: Blob; headers: Record<string, string> };
    const message = sign.mock.calls[0][0];
    for (const [label, header] of [['blobId', 'blob-id'], ['ciphertextSha256', 'ciphertext-sha256'], ['confirmationTokenHash', 'confirmation-token-hash'], ['plaintextSize', 'plaintext-size'], ['encryptedSize', 'encrypted-size'], ['owner', 'owner'], ['target', 'target'], ['issuedAt', 'issued-at'], ['expiresAt', 'expires-at']] as const) expect(message).toContain(`${label}:${request.headers[`x-chat-image-${header}`]}`);
    expect(request.headers['x-chat-image-protocol']).toBe('legacy-v1'); expect(request.headers['x-chat-image-authorization-signature']).toBe(`0x${'ab'.repeat(65)}`);
    expect(message).not.toContain(result.confirmationToken); expect(message).not.toContain(parseImageTag(result.imageTag)!.keyHex);
  });
  it.each(['', 'x'.repeat(4097)])('rejects an invalid session token before upload', async token => {
    await expect(createEncryptedImageTagFromFile(file(), 'direct', owner, target, { ...session(), token: async () => token })).rejects.toThrow(/session is invalid/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('rejects oversized plaintext before encryption/upload', async () => {
    const large = new File([new Uint8Array(MAX_IMAGE_PLAINTEXT_BYTES + 1)], 'large.png', { type: 'image/png' });
    await expect(createEncryptedImageTagFromFile(large, 'direct', owner, target, session())).rejects.toThrow(/too large/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('does not return a usable image tag after a rejected upload', async () => {
    mocks.invoke.mockResolvedValue({ error: { status: 413, message: 'too large' } });
    await expect(createEncryptedImageTagFromFile(file(), 'direct', owner, target, session())).rejects.toThrow(/too large/);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([['direct', 'x'.repeat(4097)], ['group', '0'], ['group', '9'.repeat(78)]] as const)('rejects invalid %s target metadata before upload', async (kind, conversation) => {
    await expect(createEncryptedImageTagFromFile(file(), kind, owner, conversation, session(kind === 'group' ? 'group-v2' : 'direct-v2'))).rejects.toThrow(/target/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('uses a canonical target and owner in both session headers and signed terms', async () => {
    const mixedOwner = ` ${owner.toUpperCase().replace('0X', '0x')} `;
    const mixedTarget = ` ${target.toUpperCase().replace('0X', '0x')} `;
    await createEncryptedImageTagFromFile(file(), 'direct', mixedOwner, mixedTarget, session());
    expect(mocks.invoke.mock.calls[0][1].headers).toMatchObject({ 'x-chat-image-owner': owner, 'x-chat-image-target': target });
    const sign = vi.fn(async (_message: string) => `0x${'ab'.repeat(65)}`);
    await createEncryptedImageTagFromFile(file(), 'direct', mixedOwner, mixedTarget, { mode: 'signature', sign });
    expect(sign.mock.calls[0][0]).toContain(`target:${target}`); expect(sign.mock.calls[0][0]).toContain(`owner:${owner}`);
    expect(mocks.invoke.mock.calls[1][1].headers).toMatchObject({ 'x-chat-image-owner': owner, 'x-chat-image-target': target });
  });
  it.each([['direct', 'group-v2'], ['group', 'direct-v2']] as const)('rejects %s session protocol mismatch before encryption/upload', async (kind, protocol) => {
    const attachment = file(); const read = vi.spyOn(attachment, 'arrayBuffer');
    await expect(createEncryptedImageTagFromFile(attachment, kind, owner, kind === 'direct' ? target : '123', session(protocol))).rejects.toThrow(/protocol/);
    expect(read).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('rejects an invalid owner before reading the attachment', async () => {
    const attachment = file(); const read = vi.spyOn(attachment, 'arrayBuffer');
    await expect(createEncryptedImageTagFromFile(attachment, 'direct', 'not-a-wallet', target, session())).rejects.toThrow(/wallet/);
    expect(read).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('keeps the validated session protocol fixed while retrieving its authorization token', async () => {
    const authorization = session();
    authorization.token = vi.fn(async () => { authorization.protocol = 'group-v2'; return 'test-session-token'; });
    await createEncryptedImageTagFromFile(file(), 'direct', owner, target, authorization);
    expect(mocks.invoke.mock.calls[0][1].headers).toMatchObject({ 'x-chat-image-kind': 'direct', 'x-chat-image-protocol': 'direct-v2' });
  });
});
