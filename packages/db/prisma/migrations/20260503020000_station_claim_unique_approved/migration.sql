-- Story 7.1 P2 (CR fix): partial unique index on (station_id) where
-- status = 'APPROVED'. Without this, two concurrent DOMAIN_MATCH
-- auto-approves for the same station — both passing the application-
-- layer "any other APPROVED?" precheck — could both write APPROVED
-- rows for the same station, silently violating the first-mover-wins
-- guarantee in AC6.
--
-- The full index `(station_id, user_id)` allows multiple rows per
-- station as long as users differ; this filtered index narrows the
-- uniqueness to "at most one APPROVED row per station" without
-- blocking PENDING / REJECTED rows from coexisting.
--
-- The service layer catches the resulting P2002 in approveClaim and
-- in createClaim's auto-approve path → converts to a ConflictException
-- with the standard "already managed by a verified owner" message.

CREATE UNIQUE INDEX "StationClaim_station_id_approved_unique"
    ON "StationClaim"("station_id")
    WHERE status = 'APPROVED';
