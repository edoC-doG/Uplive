import { Injectable } from '@nestjs/common';
import { JobRecord } from '../common/types';

@Injectable()
export class JobStoreService {
  private readonly jobs = new Map<string, JobRecord>();

  create(record: JobRecord): void {
    this.jobs.set(record.id, record);
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<JobRecord>): void {
    const existing = this.jobs.get(id);
    if (!existing) return;
    this.jobs.set(id, { ...existing, ...patch });
  }
}
