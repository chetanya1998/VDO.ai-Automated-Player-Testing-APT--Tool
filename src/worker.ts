import type { JsonValue } from "./contracts.js";
import type { ArtifactReferenceInput, ClaimedJob, EvidenceMetadataInput, FindingInput, PostgresStore, ReportSnapshot } from "./store.js";

export interface JobContext {
  job: ClaimedJob;
  signal: AbortSignal;
  remainingMs: number;
  saveProgress(progress: JsonValue, partialReport?: ReportSnapshot): Promise<void>;
  saveEvidenceMetadata(item: EvidenceMetadataInput): Promise<void>;
  saveArtifactReference(item: ArtifactReferenceInput): Promise<void>;
}

export interface JobOutput {
  report: ReportSnapshot;
  findings: FindingInput[];
}

export type JobHandler = (context: JobContext) => Promise<JobOutput>;

export type WorkerRunResult =
  | { state: "idle" }
  | { state: "completed"; runId: string }
  | { state: "interrupted"; runId: string; reason: string };

export class ValidatorWorker {
  private busy = false;

  constructor(
    private readonly workerId: string,
    private readonly store: PostgresStore,
    private readonly handler: JobHandler,
  ) {
    if (workerId.trim() === "") throw new TypeError("workerId is required");
  }

  async runOnce(): Promise<WorkerRunResult> {
    if (this.busy) throw new Error("worker already has an active job");
    this.busy = true;
    let job: ClaimedJob | null = null;
    let heartbeat: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    try {
      job = await this.store.claim(this.workerId);
      if (job === null) return { state: "idle" };
      const remainingMs = Math.max(0, Date.parse(job.deadlineAt) - Date.now());
      if (remainingMs === 0) throw new Error("run deadline exceeded before execution");
      deadline = setTimeout(() => controller.abort(new Error("run deadline exceeded")), remainingMs);
      deadline.unref();
      heartbeat = setInterval(() => {
        void this.store.heartbeat(job!.runId, this.workerId).then((active) => {
          if (!active) controller.abort(new Error("job lease expired"));
        }, (error: unknown) => controller.abort(error));
      }, Math.max(1, Math.floor(this.store.options.leaseMs / 3)));
      heartbeat.unref();
      const output = await this.handler({
        job,
        signal: controller.signal,
        remainingMs,
        saveProgress: (progress, partialReport) => this.store.saveProgress(job!.runId, this.workerId, progress, partialReport),
        saveEvidenceMetadata: (item) => this.store.saveEvidenceMetadata(job!.runId, this.workerId, item),
        saveArtifactReference: (item) => this.store.saveArtifactReference(job!.runId, this.workerId, item),
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      await this.store.complete(job.runId, this.workerId, output.report, output.findings);
      return { state: "completed", runId: job.runId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (job !== null) {
        const interrupted = await this.store.interrupt(job.runId, this.workerId, reason);
        if (!interrupted) await this.store.expireInterrupted();
        return { state: "interrupted", runId: job.runId, reason };
      }
      throw error;
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (deadline !== undefined) clearTimeout(deadline);
      this.busy = false;
    }
  }
}
