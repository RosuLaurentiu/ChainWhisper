revoke all on table public.trade_agent_payments
from public, anon, authenticated, service_role;

grant select, insert, update on table public.trade_agent_payments
to service_role;

revoke all on sequence public.trade_agent_payments_id_seq
from public, anon, authenticated, service_role;

grant usage on sequence public.trade_agent_payments_id_seq
to service_role;

comment on table public.trade_agent_payments is
  'Service-role-only paid Trade Agent request, receipt, bounded retry, and response-recovery state.';
