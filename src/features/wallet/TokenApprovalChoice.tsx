import { useRef, useState } from 'react';
import type { TokenApprovalMode } from '../../lib/tokenAllowance';
import { AppTooltip } from '../../shared/ui/AppTooltip';

export function useTokenApprovalMode(scope: string): [TokenApprovalMode, (mode: TokenApprovalMode) => void, () => TokenApprovalMode] {
  const [choice, setChoice] = useState<{ scope: string; mode: TokenApprovalMode }>();
  const current = useRef(choice);
  current.current = choice;
  return [choice?.scope === scope ? choice.mode : 'exact', mode => {
    current.current = { scope, mode }; setChoice(current.current);
  }, () => current.current?.scope === scope ? current.current.mode : 'exact'];
}

export default function TokenApprovalChoice({ token, spender, value, onChange, disabled }: {
  token: string; spender: string; value: TokenApprovalMode; onChange: (mode: TokenApprovalMode) => void; disabled?: boolean;
}) {
  return <div className="dex-v2-approval-policy">
    <AppTooltip text={`Spender: ${spender}`}><button type="button" role="switch" aria-checked={value === 'unlimited'}
      aria-label={`Unlimited ${token} approval`} disabled={disabled}
      onClick={() => onChange(value === 'unlimited' ? 'exact' : 'unlimited')}>
      <span>Unlimited {token} approval</span>
      <span className="dex-v2-approval-switch-track" aria-hidden="true"><i /></span>
    </button></AppTooltip>
    <small>{value === 'unlimited'
      ? 'Allows future spending until revoked. Use may be visible on-chain.'
      : 'Approve only the amount needed.'}</small>
  </div>;
}
