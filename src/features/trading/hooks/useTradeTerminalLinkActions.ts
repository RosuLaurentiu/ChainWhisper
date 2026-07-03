import { useCallback, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react';
import { loadCotiEthersModule } from '../../../lib/appShared';
import { resolveTradeLinkInput } from './useP2PTradeRoute';

type UseTradeTerminalLinkActionsArgs = {
  lastAppliedSwapPinnedTradeKeyRef: MutableRefObject<string>;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  setDetailTradeError: (message: string) => void;
  setEmptyTerminalDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSwapOrderLinkError: Dispatch<SetStateAction<string>>;
  setSwapOrderLinkInput: Dispatch<SetStateAction<string>>;
  setSwapPinnedTradeKey: Dispatch<SetStateAction<string>>;
  setTradeLinkInput: Dispatch<SetStateAction<string>>;
  showEmptyTradeRoute: () => void;
  tradeLinkInput: string;
};

export default function useTradeTerminalLinkActions({
  lastAppliedSwapPinnedTradeKeyRef,
  openTrade,
  setDetailTradeError,
  setEmptyTerminalDrawerOpen,
  setSwapOrderLinkError,
  setSwapOrderLinkInput,
  setSwapPinnedTradeKey,
  setTradeLinkInput,
  showEmptyTradeRoute,
  tradeLinkInput
}: UseTradeTerminalLinkActionsArgs) {
  const openTradeFromInput = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const parsedLink = resolveTradeLinkInput(tradeLinkInput);
      if (!parsedLink) {
        setDetailTradeError(tradeLinkInput.trim() ? 'Paste a valid trade link, compact code, or trade id.' : '');
        showEmptyTradeRoute();
        return;
      }

      setDetailTradeError('');
      setEmptyTerminalDrawerOpen(false);
      openTrade(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
      setTradeLinkInput('');
    },
    [openTrade, setDetailTradeError, setEmptyTerminalDrawerOpen, setTradeLinkInput, showEmptyTradeRoute, tradeLinkInput]
  );

  const resetSwapLinkedOrder = useCallback(() => {
    setSwapOrderLinkInput('');
    setSwapPinnedTradeKey('');
    setSwapOrderLinkError('');
    lastAppliedSwapPinnedTradeKeyRef.current = '';
  }, [lastAppliedSwapPinnedTradeKeyRef, setSwapOrderLinkError, setSwapOrderLinkInput, setSwapPinnedTradeKey]);

  const hashTradeAccessSecret = useCallback(async (accessSecret: string): Promise<string> => {
    const cotiEthers = await loadCotiEthersModule();
    return cotiEthers.keccak256(accessSecret);
  }, []);

  return {
    hashTradeAccessSecret,
    openTradeFromInput,
    resetSwapLinkedOrder
  };
}
