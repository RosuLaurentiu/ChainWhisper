import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fingerprintExtensionDirectory = async (directory: string): Promise<string> => {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) {
    throw new Error('MetaMask extension path must be a directory.');
  }

  const hash = createHash('sha256');
  const visit = async (current: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        throw new Error('Pinned MetaMask directory must not contain symbolic links.');
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        hash.update(relative);
        hash.update('\0');
        hash.update(await readFile(absolute));
        hash.update('\0');
      }
    }
  };

  await visit(root);
  return hash.digest('hex');
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error('Pass the absolute unpacked MetaMask extension directory.');
  }
  process.stdout.write(`${await fingerprintExtensionDirectory(directory)}\n`);
}
