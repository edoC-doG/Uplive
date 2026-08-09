import { Injectable } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';

@Injectable()
export class StorageService {
  readonly dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  readonly videosDir = join(this.dataDir, 'videos');
  readonly exportsDir = join(this.dataDir, 'exports');
  readonly tmpDir = join(this.dataDir, 'tmp');

  constructor() {
    for (const dir of [this.dataDir, this.videosDir, this.exportsDir, this.tmpDir]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  sourcePath(videoId: string): string {
    return join(this.videosDir, `${videoId}.mp4`);
  }

  outputPath(jobId: string): string {
    return join(this.exportsDir, `${jobId}.mp4`);
  }

  tmpPath(name: string): string {
    return join(this.tmpDir, name);
  }
}
