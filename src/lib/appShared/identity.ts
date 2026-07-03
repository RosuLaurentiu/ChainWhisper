export const shortenAddress = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`;

export const isWalletAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value.trim());

export const isShortAddress = (value: string): boolean => /^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/.test(value.trim());

export const parseWalletAddressListInput = (value: string): string[] => {
  const seen = new Set<string>();
  const parsed: string[] = [];
  const chunks = value
    .split(/[\s,;\n\r]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  for (const chunk of chunks) {
    if (!isWalletAddress(chunk)) {
      continue;
    }
    const key = chunk.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    parsed.push(chunk);
  }

  return parsed;
};

export const normalizeContactName = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const normalizeChainId = (chainId: string | number): number => {
  if (typeof chainId === 'number') return chainId;
  return chainId.startsWith('0x') ? parseInt(chainId, 16) : Number(chainId);
};
