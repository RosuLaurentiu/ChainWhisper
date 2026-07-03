import type { MouseEvent } from 'react';
import { parseChatMessageLinkParts } from '../../../lib/chatLinks';

type MessageTextWithLinksProps = {
  onOpenInternalLink?: (href: string) => void;
  text: string;
};

const shouldHandleInternalLinkClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 &&
  !event.defaultPrevented &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey;

export default function MessageTextWithLinks({ onOpenInternalLink, text }: MessageTextWithLinksProps) {
  return (
    <>
      {parseChatMessageLinkParts(text).map((part, index) => {
        if (part.type === 'text') {
          return part.text;
        }

        return (
          <a
            key={`message-link-${index}-${part.href}`}
            className="message-text-link"
            href={part.href}
            target={part.external ? '_blank' : undefined}
            rel={part.external ? 'noreferrer' : undefined}
            onClick={
              part.external || !onOpenInternalLink
                ? undefined
                : (event) => {
                    if (!shouldHandleInternalLinkClick(event)) {
                      return;
                    }

                    event.preventDefault();
                    onOpenInternalLink(part.href);
                  }
            }
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}
