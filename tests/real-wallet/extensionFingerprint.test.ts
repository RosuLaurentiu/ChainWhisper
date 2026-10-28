import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fingerprintExtensionDirectory } from './extensionFingerprint';

describe('real-wallet extension fingerprint', () => {
  it('is deterministic across creation order and changes with file content', async () => {
    const first = await mkdtemp(path.join(tmpdir(), 'cw-wallet-extension-a-'));
    const second = await mkdtemp(path.join(tmpdir(), 'cw-wallet-extension-b-'));
    await mkdir(path.join(first, 'nested'));
    await writeFile(path.join(first, 'manifest.json'), '{"version":"1.0.0"}');
    await writeFile(path.join(first, 'nested', 'worker.js'), 'first');

    await mkdir(path.join(second, 'nested'));
    await writeFile(path.join(second, 'nested', 'worker.js'), 'first');
    await writeFile(path.join(second, 'manifest.json'), '{"version":"1.0.0"}');

    const expected = await fingerprintExtensionDirectory(first);
    expect(await fingerprintExtensionDirectory(second)).toBe(expected);

    await writeFile(path.join(second, 'nested', 'worker.js'), 'second');
    expect(await fingerprintExtensionDirectory(second)).not.toBe(expected);
  });

  it('rejects a file in place of an extension directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cw-wallet-extension-file-'));
    const file = path.join(root, 'manifest.json');
    await writeFile(file, '{}');
    await expect(fingerprintExtensionDirectory(file)).rejects.toThrow(/directory/i);
  });
});
