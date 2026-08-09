import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { rename } from 'fs/promises';
import { runProcess } from '../common/process.util';
import { StorageService } from '../common/storage.service';

// Prototype safety caps: bound the worst case for disk/CPU/time before we
// even look at the video. Documented as a deliberate limitation in the README.
const MAX_DURATION_SECONDS = 900; // 15 min
const MAX_FILESIZE = '200M';
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

@Injectable()
export class YoutubeService {
  constructor(private readonly storage: StorageService) {}

  async download(url: string, videoId: string, onProgress?: (pct: number) => void): Promise<string> {
    const template = this.storage.tmpPath(`${videoId}.%(ext)s`);
    const finalPath = this.storage.sourcePath(videoId);

    await runProcess(
      'yt-dlp',
      [
        '-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--max-filesize', MAX_FILESIZE,
        '--match-filter', `duration <= ${MAX_DURATION_SECONDS}`,
        '--retries', '3',
        '--socket-timeout', '30',
        '--no-progress',
        '-o', template,
        url,
      ],
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        onOutputLine: (line) => {
          const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (match && onProgress) onProgress(Number(match[1]));
        },
      },
    );

    const downloadedPath = this.storage.tmpPath(`${videoId}.mp4`);
    if (!existsSync(downloadedPath)) {
      throw new Error('Download finished but no output file was produced (video may exceed the 15min/200MB prototype limit).');
    }
    await rename(downloadedPath, finalPath);
    return finalPath;
  }

  async probe(filePath: string): Promise<VideoMetadata> {
    const output = await runProcess(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeoutMs: PROBE_TIMEOUT_MS },
    );
    const data = JSON.parse(output);
    const videoStream = (data.streams || []).find((s: any) => s.codec_type === 'video');
    const duration = Number(data.format?.duration ?? videoStream?.duration ?? 0);
    return {
      duration,
      width: Number(videoStream?.width ?? 0),
      height: Number(videoStream?.height ?? 0),
    };
  }
}
