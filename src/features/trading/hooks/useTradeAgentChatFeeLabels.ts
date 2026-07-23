import { useEffect, useState } from 'react';
import { formatTradeAgentFeeLabel } from '../../../app/appHelpers';
import { fetchTradeAgentFeeEstimate } from '../../../lib/tradeAgent';

export default function useTradeAgentChatFeeLabels() {
  const [labels, setLabels] = useState({
    chat_to_trade: 'paid',
    draft_counter: 'paid'
  });

  useEffect(() => {
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
  }, []);

  return labels;
}
