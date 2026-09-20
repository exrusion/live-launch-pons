UPDATE pons_launches
SET submitted_at=COALESCE(submitted_at,updated_at,created_at)
WHERE status IN ('SUBMITTED','CONFIRMING') AND submitted_at IS NULL;
