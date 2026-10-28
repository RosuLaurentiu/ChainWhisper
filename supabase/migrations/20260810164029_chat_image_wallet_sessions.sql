alter table public.chat_image_uploads
  add column if not exists protocol_version smallint;

update public.chat_image_uploads
set protocol_version = 1
where protocol_version is null;

alter table public.chat_image_uploads
  alter column protocol_version set default 1,
  alter column protocol_version set not null,
  drop constraint if exists chat_image_uploads_protocol_version_check,
  drop constraint if exists chat_image_uploads_authorization_version_check,
  drop constraint if exists chat_image_uploads_authorization_state_check;

alter table public.chat_image_uploads
  add constraint chat_image_uploads_protocol_version_check
    check (protocol_version in (1, 2)),
  add constraint chat_image_uploads_authorization_version_check
    check (authorization_version in (0, 1, 2)),
  add constraint chat_image_uploads_authorization_state_check
    check (
      (
        authorization_version = 0
        and protocol_version = 1
        and conversation_target is null
        and ciphertext_sha256 is null
        and confirmation_token_hash is null
        and authorization_issued_at is null
        and authorization_expires_at is null
      )
      or (
        authorization_version in (1, 2)
        and conversation_target is not null
        and ciphertext_sha256 is not null
        and confirmation_token_hash is not null
        and authorization_issued_at is not null
        and authorization_expires_at is not null
        and authorization_expires_at > authorization_issued_at
        and authorization_expires_at <= authorization_issued_at + interval '15 minutes'
        and (
          (
            confirmed_at is null
            and confirmed_tx_hash is null
          )
          or (
            confirmed_at is not null
            and confirmed_tx_hash is not null
          )
        )
      )
    );

comment on column public.chat_image_uploads.protocol_version is
  '1 = legacy ChatGC/GroupChat calldata confirmation, 2 = stable Direct/Group V2 event confirmation.';

comment on column public.chat_image_uploads.authorization_version is
  '0 = legacy unsigned row, 1 = per-upload wallet signature, 2 = short-lived wallet-scoped upload session.';
