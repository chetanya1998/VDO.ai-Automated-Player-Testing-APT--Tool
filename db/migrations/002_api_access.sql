ALTER TABLE validator_runs
  ADD COLUMN team_id text NOT NULL DEFAULT 'system',
  ADD COLUMN user_id text NOT NULL DEFAULT 'system',
  ADD COLUMN idempotency_key text,
  ADD COLUMN submission_hash text,
  ADD CONSTRAINT validator_runs_team_id_check CHECK (team_id <> ''),
  ADD CONSTRAINT validator_runs_user_id_check CHECK (user_id <> ''),
  ADD CONSTRAINT validator_runs_idempotency_check CHECK (
    (idempotency_key IS NULL AND submission_hash IS NULL)
    OR (idempotency_key <> '' AND octet_length(idempotency_key) <= 200 AND submission_hash <> '')
  );

CREATE UNIQUE INDEX validator_runs_team_idempotency_idx
  ON validator_runs (team_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX validator_runs_team_created_idx
  ON validator_runs (team_id, created_at DESC, run_id);
