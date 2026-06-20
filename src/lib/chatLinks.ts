export type ChatMessageLinkPart =
  | { type: 'text'; text: string }
  | { external: boolean; href: string; text: string; type: 'link' };

const MESSAGE_LINK_PATTERN = /(https?:\/\/[^\s<>"']+|\/(?:otcdesk|otc|trades)(?:\/[^\s<>"']*)?)/gi;
const TRAILING_LINK_PUNCTUATION_PATTERN = /[),.!?;:]+$/;

const splitTrailingLinkPunctuation = (value: string): { linkText: string; trailingText: string } => {
  const trailingMatch = value.match(TRAILING_LINK_PUNCTUATION_PATTERN);
  if (!trailingMatch) {
    return { linkText: value, trailingText: '' };
  }

  const trailingText = trailingMatch[0];
  return {
    linkText: value.slice(0, -trailingText.length),
    trailingText
  };
};

const getCurrentOrigin = (): string => {
  if (typeof window === 'undefined') {
    return 'https://chainwhisper.local';
  }

  return window.location.origin;
};

const isInternalAppPathname = (pathname: string): boolean => {
  const normalizedPathname = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return (
    normalizedPathname === '/' ||
    normalizedPathname === '/home' ||
    normalizedPathname === '/chat' ||
    normalizedPathname === '/messages' ||
    normalizedPathname === '/messenger' ||
    normalizedPathname === '/shield' ||
    normalizedPathname === '/swap' ||
    normalizedPathname === '/whisper-shield' ||
    normalizedPathname === '/treasury' ||
    normalizedPathname === '/treasury-data' ||
    normalizedPathname === '/otc' ||
    normalizedPathname.startsWith('/otc/') ||
    normalizedPathname === '/otcdesk' ||
    normalizedPathname.startsWith('/otcdesk/') ||
    normalizedPathname === '/trades' ||
    normalizedPathname.startsWith('/trades/')
  );
};

export const resolveChatMessageLink = (
  value: string,
  currentOrigin = getCurrentOrigin()
): { external: boolean; href: string } | null => {
  try {
    const url = new URL(value, currentOrigin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    const redirectedPath = new URLSearchParams(url.search).get('p') ?? '';
    const isRedirectedInternalPath = redirectedPath ? isInternalAppPathname(new URL(redirectedPath, currentOrigin).pathname) : false;
    const isSameOrigin = url.origin === currentOrigin;
    if (isSameOrigin && (isInternalAppPathname(url.pathname) || isRedirectedInternalPath)) {
      return {
        external: false,
        href: `${url.pathname}${url.search}${url.hash}`
      };
    }

    if (value.startsWith('/')) {
      return null;
    }

    return { external: true, href: url.toString() };
  } catch {
    return null;
  }
};

export const parseChatMessageLinkParts = (
  text: string,
  currentOrigin = getCurrentOrigin()
): ChatMessageLinkPart[] => {
  const parts: ChatMessageLinkPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MESSAGE_LINK_PATTERN)) {
    const rawMatch = match[0];
    const matchIndex = match.index ?? 0;
    const { linkText, trailingText } = splitTrailingLinkPunctuation(rawMatch);
    const link = resolveChatMessageLink(linkText, currentOrigin);
    if (!link || linkText.length === 0) {
      continue;
    }

    if (matchIndex > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, matchIndex) });
    }
    parts.push({ type: 'link', text: linkText, href: link.href, external: link.external });
    if (trailingText) {
      parts.push({ type: 'text', text: trailingText });
    }
    lastIndex = matchIndex + rawMatch.length;
  }

  if (lastIndex === 0) {
    return [{ type: 'text', text }];
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return parts;
};
