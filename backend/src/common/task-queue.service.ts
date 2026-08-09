import { Injectable, Logger } from '@nestjs/common';

interface QueuedTask {
  id: string;
  run: () => Promise<void>;
}

/**
 * Single shared FIFO queue for every CPU-heavy operation (yt-dlp downloads
 * AND ffmpeg exports). At most one task runs at a time, by design - this is
 * the mechanism that keeps the whole app inside a 0.5 vCPU budget instead of
 * spawning concurrent processes that would thrash/OOM the container.
 */
@Injectable()
export class TaskQueueService {
  private readonly logger = new Logger(TaskQueueService.name);
  private queue: QueuedTask[] = [];
  private processing = false;

  push(task: QueuedTask): void {
    this.queue.push(task);
    this.logger.log(`Queued ${task.id} (${this.pendingCount} pending)`);
    void this.drain();
  }

  /** Includes the task currently running, if any - used for queue-position feedback in the UI. */
  get pendingCount(): number {
    return this.queue.length + (this.processing ? 1 : 0);
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    const next = this.queue.shift();
    if (!next) return;

    this.processing = true;
    try {
      await next.run();
    } catch (err) {
      this.logger.error(`Task ${next.id} failed: ${(err as Error).message}`);
    } finally {
      this.processing = false;
      void this.drain();
    }
  }
}
