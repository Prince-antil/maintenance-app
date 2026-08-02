alter table public.machines
add column if not exists attachments jsonb not null default '[]'::jsonb;

update public.machines
set attachments = case
  when jsonb_typeof(payload -> 'attachments') = 'array' then payload -> 'attachments'
  else coalesce(attachments, '[]'::jsonb)
end,
payload = coalesce(payload, '{}'::jsonb) - 'attachments'
where payload ? 'attachments';
