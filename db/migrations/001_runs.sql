CREATE TABLE validator_profiles (
  profile_id text NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  profile_hash text NOT NULL CHECK (profile_hash <> ''),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (profile_id, profile_version),
  UNIQUE (profile_id, profile_hash),
  CHECK (octet_length(snapshot::text) <= 1048576)
);

CREATE TABLE validator_runs (
  run_id text PRIMARY KEY,
  profile_id text NOT NULL,
  profile_version integer NOT NULL,
  target_url text NOT NULL,
  device_id text NOT NULL,
  execution_state text NOT NULL DEFAULT 'queued'
    CHECK (execution_state IN ('queued', 'running', 'completed', 'timed_out', 'errored')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deadline_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  interrupted_at timestamptz,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  partial_report jsonb,
  final_report jsonb,
  retention_until timestamptz NOT NULL,
  FOREIGN KEY (profile_id, profile_version) REFERENCES validator_profiles(profile_id, profile_version),
  CHECK (deadline_at > created_at),
  CHECK (retention_until > created_at),
  CHECK (octet_length(progress::text) <= 65536),
  CHECK (partial_report IS NULL OR octet_length(partial_report::text) <= 1048576),
  CHECK (final_report IS NULL OR octet_length(final_report::text) <= 1048576)
);

CREATE TABLE validator_jobs (
  job_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id text NOT NULL UNIQUE REFERENCES validator_runs(run_id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'leased', 'completed', 'interrupted')),
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deadline_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  interrupted_at timestamptz,
  interruption_reason text,
  CHECK ((state = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX validator_jobs_claim_idx ON validator_jobs (queued_at, job_id)
  WHERE state = 'queued';
CREATE INDEX validator_jobs_lease_idx ON validator_jobs (lease_expires_at)
  WHERE state = 'leased';

CREATE TABLE validator_evidence_metadata (
  evidence_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES validator_runs(run_id) ON DELETE CASCADE,
  article_epoch_id text NOT NULL,
  device_id text NOT NULL,
  source text NOT NULL,
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL,
  CHECK (octet_length(metadata::text) <= 65536)
);

CREATE INDEX validator_evidence_run_idx ON validator_evidence_metadata (run_id, captured_at);

CREATE TABLE validator_findings (
  run_id text NOT NULL REFERENCES validator_runs(run_id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('check', 'diagnosis')),
  category text NOT NULL,
  verdict text NOT NULL,
  evidence_ids text[] NOT NULL CHECK (cardinality(evidence_ids) > 0),
  payload jsonb NOT NULL,
  PRIMARY KEY (run_id, finding_id),
  CHECK (octet_length(payload::text) <= 262144)
);

CREATE TABLE validator_artifact_refs (
  artifact_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES validator_runs(run_id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_ref text NOT NULL UNIQUE,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retention_until timestamptz NOT NULL
);

CREATE INDEX validator_artifact_retention_idx ON validator_artifact_refs (retention_until);
