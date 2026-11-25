-- 046: The vehicle's asset number in the Acumatica fixed asset register (e.g. VEH0126), so the fleet master and the FAR can be
-- tied line for line when a vehicle is bought, sold or written off. Leased (Avis) vehicles are not ICS assets and stay blank.
alter table fleet_vehicles add column if not exists far_asset_id text;
comment on column fleet_vehicles.far_asset_id is 'Acumatica fixed asset ID of the vehicle itself (canopies and other fittings have their own asset lines)';
