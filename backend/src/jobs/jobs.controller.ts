import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { ok } from '../common/api-response';
import { TaskQueueService } from '../common/task-queue.service';
import { VideoStoreService } from '../videos/video-store.service';
import { CreateExportDto } from './dto';
import { ExportService } from './export.service';
import { JobStoreService } from './job-store.service';

@Controller('api')
export class JobsController {
  constructor(
    private readonly jobs: JobStoreService,
    private readonly videos: VideoStoreService,
    private readonly exportService: ExportService,
    private readonly queue: TaskQueueService,
  ) {}

  @Post('videos/:videoId/export')
  create(@Param('videoId') videoId: string, @Body() body: CreateExportDto) {
    const video = this.videos.get(videoId);
    if (!video || video.status !== 'ready' || !video.filePath) {
      throw new BadRequestException('Video is not ready for export yet.');
    }
    if (body.transitions.length !== body.clips.length - 1) {
      throw new BadRequestException('transitions must have exactly clips.length - 1 entries.');
    }
    for (const clip of body.clips) {
      if (clip.end <= clip.start) {
        throw new BadRequestException('Each clip end must be greater than its start.');
      }
      if (video.duration && clip.end > video.duration + 0.5) {
        throw new BadRequestException(`Clip range exceeds video duration (${video.duration}s).`);
      }
    }

    const id = uuid();
    this.jobs.create({
      id,
      videoId,
      status: 'queued',
      createdAt: Date.now(),
      request: { clips: body.clips, transitions: body.transitions },
    });

    const sourcePath = video.filePath;
    this.queue.push({
      id: `export:${id}`,
      run: async () => {
        this.jobs.update(id, { status: 'processing', progress: 0 });
        try {
          const outputPath = await this.exportService.run(
            id,
            sourcePath,
            body.clips,
            body.transitions,
            (pct) => this.jobs.update(id, { progress: pct }),
          );
          this.jobs.update(id, { status: 'done', outputPath, progress: 100 });
        } catch (err) {
          this.jobs.update(id, { status: 'error', error: (err as Error).message });
        }
      },
    });

    return ok({ jobId: id, status: 'queued', queuePosition: this.queue.pendingCount });
  }

  @Get('jobs/:id')
  getOne(@Param('id') id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Job not found');
    const { outputPath, ...safe } = job;
    return ok({ ...safe, downloadUrl: job.status === 'done' ? `/api/jobs/${id}/download` : undefined });
  }

  @Get('jobs/:id/download')
  download(@Param('id') id: string, @Res() res: Response) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'done' || !job.outputPath || !existsSync(job.outputPath)) {
      throw new NotFoundException('Export not ready');
    }
    res.setHeader('Content-Disposition', `attachment; filename="clip-${id}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');
    createReadStream(job.outputPath).pipe(res);
  }
}
