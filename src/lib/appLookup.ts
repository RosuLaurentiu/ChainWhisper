export const isAlreadyKnownTransactionError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (typeof current === 'string') {
      if (current.toLowerCase().includes('already known')) {
        return true;
      }
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      stack.push(value);
    }
  }

  return false;
};

export const extractRawTransactionFromError = (error: unknown): string | undefined => {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (typeof current === 'string') {
      const rawTransaction = current.match(/0x[0-9a-fA-F]{100,}/)?.[0];
      if (rawTransaction) {
        return rawTransaction;
      }
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    if (typeof current === 'object') {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
  }

  return undefined;
};
