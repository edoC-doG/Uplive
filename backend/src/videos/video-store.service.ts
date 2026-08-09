import { Injectable } from '@nestjs/common';
import { VideoRecord } from '../common/types';

/**
 * In-memory store - deliberately not a database. State is lost on restart,
 * which is an acceptable trade for a prototype (see README); the object
 * shape here is exactly what a Postgres row would look like if this grew up.
 */
@Injectable()
export class VideoStoreService {
  private readonly videos = new Map<string, VideoRecord>();

  create(record: VideoRecord): void {
    this.videos.set(record.id, record);
  }

  get(id: string): VideoRecord | undefined {
    return this.videos.get(id);
  }

  update(id: string, patch: Partial<VideoRecord>): void {
    const existing = this.videos.get(id);
    if (!existing) return;
    this.videos.set(id, { ...existing, ...patch });
  }
}
