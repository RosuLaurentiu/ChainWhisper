import { useEffect, useState } from 'react';
import { formatTradeAgentFeeLabel } from '../../../app/appHelpers';
import { fetchTradeAgentFeeEstimate } from '../../../lib/tradeAgent';

export const shouldLoadTradeAgentChatFeeLabels = (activePage: string): boolean =>
  activePage === 'chat';

export default function useTradeAgentChatFeeLabels(enabled: boolean) {
  const [labels, setLabels] = useState({
    chat_to_trade: 'paid',
    draft_counter: 'paid'
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    fetchTradeAgentFeeEstimate('draft_counter')
      .then((quote) => {
        if (active) {
          setLabels((previous) => ({ ...previous, draft_counter: formatTradeAgentFeeLabel(quote) }));
        }
      })
      .catch(() => {});
    fetchTradeAgentFeeEstimate('chat_to_trade')
      .then((quote) => {
        if (active) {
          setLabels((previous) => ({ ...previous, chat_to_trade: formatTradeAgentFeeLabel(quote) }));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled]);

  return labels;
}
