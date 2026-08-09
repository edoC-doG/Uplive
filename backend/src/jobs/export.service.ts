import { Injectable } from '@nestjs/common';
import { writeFile } from 'fs/promises';
import { runProcess } from '../common/process.util';
import { StorageService } from '../common/storage.service';
import { ClipSelection, TransitionType } from '../common/types';

const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;
const TRANSITION_DURATION_S = 0.75;
const CUT_DURATION_S = 0.05; // near-zero xfade so "cut" shares the same chain math as fade/slide

const XFADE_STYLE: Record<TransitionType, string> = {
  cut: 'fade', // duration is negligible either way, so the visual style doesn't matter
  fade: 'fade',
  slide: 'slideleft',
};

const CANVAS_WIDTH = 854;
const CANVAS_HEIGHT = 480;
const FPS = 30;

/**
 * Two export strategies, chosen per job:
 *
 *  - Pure cuts only -> stream-copy trim + concat demuxer. No re-encoding at
 *    all, near-zero CPU. This is the common case and it's essentially free.
 *
 *  - Any fade/slide transition -> a single ffmpeg process with one
 *    filter_complex graph (trim -> chained xfade/acrossfade -> one encode of
 *    only the final output). We deliberately do NOT use the more
 *    CPU-optimal "re-encode just the ~1s transition window, stream-copy the
 *    rest, concat demuxer them back together" pattern: that requires the
 *    re-encoded and copied segments to match codec/profile/pix_fmt/timebase
 *    exactly or the concat demuxer fails, which is a classic ffmpeg
 *    debugging trap. Documented in the README as a deferred optimization.
 */
@Injectable()
export class ExportService {
  constructor(private readonly storage: StorageService) {}

  async run(
    jobId: string,
    sourcePath: string,
    clips: ClipSelection[],
    transitions: TransitionType[],
    onProgress?: (pct: number) => void,
  ): Promise<string> {
    const outputPath = this.storage.outputPath(jobId);
    const allCuts = clips.length === 1 || transitions.every((t) => t === 'cut');

    if (allCuts) {
      await this.exportByStreamCopy(jobId, sourcePath, clips, outputPath);
    } else {
      await this.exportByFilterGraph(sourcePath, clips, transitions, outputPath, onProgress);
    }
    return outputPath;
  }

  private async exportByStreamCopy(
    jobId: string,
    sourcePath: string,
    clips: ClipSelection[],
    outputPath: string,
  ): Promise<void> {
    if (clips.length === 1) {
      await runProcess(
        'ffmpeg',
        [
          '-y',
          '-ss', String(clips[0].start),
          '-to', String(clips[0].end),
          '-i', sourcePath,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          outputPath,
        ],
        { timeoutMs: EXPORT_TIMEOUT_MS },
      );
      return;
    }

    const segmentPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const segPath = this.storage.tmpPath(`${jobId}-seg${i}.mp4`);
      await runProcess(
        'ffmpeg',
        [
          '-y',
          '-ss', String(clips[i].start),
          '-to', String(clips[i].end),
          '-i', sourcePath,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          segPath,
        ],
        { timeoutMs: EXPORT_TIMEOUT_MS },
      );
      segmentPaths.push(segPath);
    }

    const listFile = this.storage.tmpPath(`${jobId}-list.txt`);
    const listContent = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await writeFile(listFile, listContent, 'utf8');

    await runProcess(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath],
      { timeoutMs: EXPORT_TIMEOUT_MS },
    );
  }

  private async exportByFilterGraph(
    sourcePath: string,
    clips: ClipSelection[],
    transitions: TransitionType[],
    outputPath: string,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const args: string[] = ['-y'];
    for (const clip of clips) {
      args.push('-ss', String(clip.start), '-to', String(clip.end), '-i', sourcePath);
    }

    let filter = '';
    const vLabels: string[] = [];
    const aLabels: string[] = [];
    clips.forEach((_, i) => {
      filter +=
        `[${i}:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p,setsar=1[v${i}b];`;
      filter += `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}b];`;
      vLabels.push(`v${i}b`);
      aLabels.push(`a${i}b`);
    });

    const clipDurations = clips.map((c) => c.end - c.start);
    let cumulative = clipDurations[0];
    let prevV = vLabels[0];
    let prevA = aLabels[0];

    for (let i = 1; i < clips.length; i++) {
      const type = transitions[i - 1];
      const t = type === 'cut' ? CUT_DURATION_S : TRANSITION_DURATION_S;
      const offset = Math.max(cumulative - t, 0);
      const outV = `vx${i}`;
      const outA = `ax${i}`;
      filter += `[${prevV}][${vLabels[i]}]xfade=transition=${XFADE_STYLE[type]}:duration=${t}:offset=${offset.toFixed(3)}[${outV}];`;
      filter += `[${prevA}][${aLabels[i]}]acrossfade=d=${t}[${outA}];`;
      cumulative = cumulative + clipDurations[i] - t;
      prevV = outV;
      prevA = outA;
    }

    filter += `[${prevV}]null[vout];[${prevA}]anull[aout]`;
    const totalDuration = cumulative;

    args.push(
      '-filter_complex', filter,
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    );

    await runProcess('ffmpeg', args, {
      timeoutMs: EXPORT_TIMEOUT_MS,
      onOutputLine: (line) => {
        if (!onProgress) return;
        const match = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          onProgress(Math.min(99, Math.round((seconds / totalDuration) * 100)));
        }
      },
    });
  }
}
