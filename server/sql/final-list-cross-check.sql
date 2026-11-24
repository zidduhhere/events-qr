-- Verify the latest final CSV batch against the reconciled SQLite registrations.
-- Join by preserved participant ID: final registration numbers were reassigned.
WITH latest AS (
 SELECT id FROM registration_imports WHERE filename='final-csv'
 ORDER BY created_at DESC LIMIT 1
), rows_checked AS (
 SELECT stage.*,
  CASE WHEN p.id IS NULL OR p.removed_at IS NOT NULL
    OR p.registration_number IS NOT stage.registration_number
    OR p.name<>json_extract(stage.desired_json,'$.name')
    OR p.phone<>json_extract(stage.desired_json,'$.phone')
    OR p.category IS NOT json_extract(stage.desired_json,'$.category')
    OR p.hospital IS NOT json_extract(stage.desired_json,'$.hospital')
    OR p.food_requirement IS NOT json_extract(stage.desired_json,'$.foodRequirement')
    OR p.lunch_override IS NOT (json_extract(stage.desired_json,'$.meals[0]')+json_extract(stage.desired_json,'$.meals[2]'))
    OR p.dinner_override IS NOT json_extract(stage.desired_json,'$.meals[1]')
    OR p.total_override IS NOT (json_extract(stage.desired_json,'$.meals[0]')+json_extract(stage.desired_json,'$.meals[1]')+json_extract(stage.desired_json,'$.meals[2]'))
    OR (SELECT count(*) FROM participant_meal_eligibility e JOIN meal_sessions s ON s.id=e.session_id
      WHERE e.participant_id=p.id AND s.archived=0 AND (
        (s.name='2026-11-28 · Lunch' AND e.eligible=json_extract(stage.desired_json,'$.meals[0]')) OR
        (s.name='2026-11-28 · Dinner' AND e.eligible=json_extract(stage.desired_json,'$.meals[1]')) OR
        (s.name='2026-11-29 · Lunch' AND e.eligible=json_extract(stage.desired_json,'$.meals[2]'))
      ))<>3
    THEN 1 ELSE 0 END AS mismatch
 FROM final_registration_stage stage LEFT JOIN participants p ON p.id=stage.participant_id
 WHERE stage.batch_id=(SELECT id FROM latest)
)
SELECT count(*) AS final_registrations,coalesce(sum(mismatch),0) AS mismatched_registrations,
 sum(json_extract(desired_json,'$.meals[0]')) AS lunch_28,
 sum(json_extract(desired_json,'$.meals[1]')) AS dinner_28,
 sum(json_extract(desired_json,'$.meals[2]')) AS lunch_29,
 sum(CASE WHEN match_method='new' THEN 1 ELSE 0 END) AS new_registrations,
 (SELECT count(*) FROM participants p WHERE p.source_import IS NOT NULL AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM rows_checked r WHERE r.participant_id=p.id)) AS active_imported_outside_final,
 (SELECT count(*) FROM participants p WHERE p.source_import IS NULL AND p.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM rows_checked r WHERE r.participant_id=p.id)) AS manual_registrations_preserved
FROM rows_checked;
