CREATE TABLE validator_batches (
  batch_id text PRIMARY KEY,
  team_id text NOT NULL CHECK (team_id <> ''),
  user_id text NOT NULL CHECK (user_id <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key <> '' AND octet_length(idempotency_key) <= 200),
  submission_hash text NOT NULL CHECK (submission_hash <> ''),
  profile_id text NOT NULL,
  profile_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (team_id, idempotency_key),
  FOREIGN KEY (profile_id, profile_version) REFERENCES validator_profiles(profile_id, profile_version)
);

CREATE INDEX validator_batches_team_created_idx
  ON validator_batches (team_id, created_at DESC, batch_id);

CREATE TABLE validator_batch_items (
  batch_id text NOT NULL REFERENCES validator_batches(batch_id) ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  target_url text NOT NULL,
  device_id text NOT NULL,
  admission_state text NOT NULL CHECK (admission_state IN ('accepted', 'rejected')),
  run_id text UNIQUE REFERENCES validator_runs(run_id) ON DELETE SET NULL,
  error_code text,
  error_message text,
  PRIMARY KEY (batch_id, item_index),
  CHECK (
    (admission_state = 'accepted' AND error_code IS NULL AND error_message IS NULL)
    OR
    (admission_state = 'rejected' AND run_id IS NULL AND error_code <> '' AND error_message <> '')
  )
);
