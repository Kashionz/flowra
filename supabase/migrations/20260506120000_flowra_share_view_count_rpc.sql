create or replace function public.increment_flowra_share_view_count(target_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.flowra_share_links
  set view_count = view_count + 1
  where slug = target_slug
    and expires_at > timezone('utc', now());

  if not found then
    raise exception '分享連結不存在或已過期。';
  end if;
end;
$$;

revoke all on function public.increment_flowra_share_view_count(text) from public;
grant execute on function public.increment_flowra_share_view_count(text) to anon, authenticated;
