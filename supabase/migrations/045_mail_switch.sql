-- 045: the e-mail switch.
-- 1) Nothing is queued while notifications are off. Before this, every submit / approve / return queued a mail even with the
--    switch off (286 had built up by 18 Nov 2026), and switching the mail service on would have released them all at once.
-- 2) Links in the mails use the app's own address.
create or replace function fleet_notifications_gate()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if coalesce((select value from fleet_settings where key = 'notifications_enabled'), 'false') <> 'true' then return null; end if;
  return new;
end $$;

drop trigger if exists fleet_notifications_gate on fleet_notifications;
create trigger fleet_notifications_gate before insert on fleet_notifications for each row execute function fleet_notifications_gate();

update fleet_settings set value = 'https://fleet.asiconnect.co.za/' where key = 'app_url';
update fleet_settings set description = 'true = send approval / reminder e-mails through Microsoft 365 (needs the mail keys on the server); false = managers approve under Approvals, nothing is queued or sent' where key = 'notifications_enabled';
update fleet_settings set description = 'Mailbox the app sends from (a Microsoft 365 shared mailbox)' where key = 'notify_from';
