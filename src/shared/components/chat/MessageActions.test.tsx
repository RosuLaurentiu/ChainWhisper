import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../lib/appShared';
import MessageActions from './MessageActions';

const message = {
  id: 'message-7',
  direction: 'incoming',
  text: 'Draft a trade for 1 p.COTI and 3.8 p.gCOTI.'
} as ChatMessage;

describe('MessageActions', () => {
  it('renders a persistent busy spinner while a trade draft is loading', () => {
    const markup = renderToStaticMarkup(
      <MessageActions
        message={message}
        pickerOpen={false}
        reactedEmojiSet={new Set()}
        sendingReaction={false}
        reactionDisabled={false}
        reactionTitle="React"
        draftTradeDisabled
        draftTradeLoading
        draftTradeTitle="Drafting trade..."
        replyDisabled={false}
        replyTitle="Reply"
        onDraftTradeFromMessage={vi.fn()}
        onToggleReactionPicker={vi.fn()}
        onSendReaction={vi.fn()}
        onReplyToMessage={vi.fn()}
      />
    );

    expect(markup).toContain('message-draft-trade-action loading');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Drafting trade from this message"');
    expect(markup).toContain('lucide-loader-circle');
    expect(markup).toContain('disabled=""');
  });
});
