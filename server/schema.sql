BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS passes (
 id text PRIMARY KEY CHECK(id IN ('platinum','silver','registered')), name text NOT NULL,
 lunch_limit integer NOT NULL CHECK(lunch_limit BETWEEN 0 AND 10000),
 dinner_limit integer NOT NULL CHECK(dinner_limit BETWEEN 0 AND 10000),
 total_limit integer NOT NULL CHECK(total_limit BETWEEN 0 AND 10000)
);
INSERT INTO passes VALUES ('platinum','Platinum',2,2,4),('silver','Silver',2,2,4) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS participants (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), phone text NOT NULL,
 pass_id text NOT NULL REFERENCES passes(id), parent_id text REFERENCES participants(id),
 qr_token text NOT NULL UNIQUE, lunch_override integer CHECK(lunch_override BETWEEN 0 AND 10000),
 dinner_override integer CHECK(dinner_override BETWEEN 0 AND 10000), total_override integer CHECK(total_override BETWEEN 0 AND 10000),
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), CHECK(parent_id IS DISTINCT FROM id)
);
CREATE INDEX IF NOT EXISTS participants_parent ON participants(parent_id);
CREATE TABLE IF NOT EXISTS meal_sessions (
 id text PRIMARY KEY, name text NOT NULL, meal_type text NOT NULL CHECK(meal_type IN ('lunch','dinner')),
 archived integer NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 status text NOT NULL CHECK(status IN ('open','closed')), per_person_limit integer NOT NULL CHECK(per_person_limit BETWEEN 1 AND 10000),
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS redemptions (
 id text PRIMARY KEY, request_id text NOT NULL UNIQUE, participant_id text NOT NULL REFERENCES participants(id),
 session_id text NOT NULL REFERENCES meal_sessions(id), meal_type text NOT NULL CHECK(meal_type IN ('lunch','dinner')),
 device_label text NOT NULL DEFAULT '', created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 voided_at text, void_reason text, CHECK((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE INDEX IF NOT EXISTS redemptions_active ON redemptions(participant_id,session_id) WHERE voided_at IS NULL;
CREATE TABLE IF NOT EXISTS scan_requests (
 request_id text PRIMARY KEY, qr_token text NOT NULL, session_id text NOT NULL,
 result text NOT NULL CHECK(json_valid(result)), created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS audit_events (
 id text PRIMARY KEY, action text NOT NULL, entity_id text NOT NULL, device_label text NOT NULL DEFAULT '',
 details text NOT NULL DEFAULT '{}' CHECK(json_valid(details)), created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_events(created_at DESC);
CREATE TABLE IF NOT EXISTS print_settings (
 id integer PRIMARY KEY CHECK(id=1), width_mm integer NOT NULL CHECK(width_mm BETWEEN 30 AND 150),
 height_mm integer NOT NULL CHECK(height_mm BETWEEN 25 AND 200)
);
INSERT INTO print_settings VALUES(1,50,40) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS registration_imports (
 id text PRIMARY KEY, filename text NOT NULL, summary text NOT NULL CHECK(json_valid(summary)),
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS participant_meal_eligibility (
 participant_id text NOT NULL REFERENCES participants(id), session_id text NOT NULL REFERENCES meal_sessions(id),
 eligible integer NOT NULL CHECK(eligible IN (0,1)), PRIMARY KEY(participant_id,session_id)
);
CREATE TABLE IF NOT EXISTS participant_qr_images (
 participant_id text PRIMARY KEY REFERENCES participants(id), png blob NOT NULL,
 created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
COMMIT;
