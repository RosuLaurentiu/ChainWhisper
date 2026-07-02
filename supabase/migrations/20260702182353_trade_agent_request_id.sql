alter table public.trade_agent_payments
  add column if not exists request_id text;

create unique index if not exists trade_agent_payments_request_id_idx
  on public.trade_agent_payments (request_id)
  where request_id is not null;
