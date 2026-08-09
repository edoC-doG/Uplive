import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { ok } from '../common/api-response';
import { TaskQueueService } from '../common/task-queue.service';
import { CreateVideoDto } from './dto';
import { VideoStoreService } from './video-store.service';
import { YoutubeService } from './youtube.service';
import { isValidYoutubeUrl } from './youtube.util';

@Controller('api/videos')
export class VideosController {
  constructor(
    private readonly store: VideoStoreService,
    private readonly youtube: YoutubeService,
    private readonly queue: TaskQueueService,
  ) {}

  @Post()
  create(@Body() body: CreateVideoDto) {
    if (!isValidYoutubeUrl(body.url)) {
      throw new BadRequestException('Please provide a valid youtube.com or youtu.be video URL.');
    }
    const id = uuid();
    this.store.create({ id, url: body.url, status: 'queued', createdAt: Date.now() });

    this.queue.push({
      id: `download:${id}`,
      run: async () => {
        this.store.update(id, { status: 'downloading', progress: 0 });
        try {
          const filePath = await this.youtube.download(body.url, id, (pct) =>
            this.store.update(id, { progress: pct }),
          );
          const meta = await this.youtube.probe(filePath);
          this.store.update(id, {
            status: 'ready',
            filePath,
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            progress: 100,
          });
        } catch (err) {
          this.store.update(id, { status: 'error', error: (err as Error).message });
        }
      },
    });

    return ok({ id, status: 'queued', queuePosition: this.queue.pendingCount });
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const video = this.store.get(id);
    if (!video) throw new NotFoundException('Video not found');
    const { filePath, ...safe } = video;
    return ok(safe);
  }

  @Get(':id/source')
  streamSource(@Param('id') id: string, @Headers('range') range: string | undefined, @Res() res: Response) {
    const video = this.store.get(id);
    if (!video || video.status !== 'ready' || !video.filePath || !existsSync(video.filePath)) {
      throw new NotFoundException('Video not ready');
    }

    const { size } = statSync(video.filePath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    if (!range) {
      res.setHeader('Content-Length', size.toString());
      createReadStream(video.filePath).pipe(res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? parseInt(match[2], 10) : size - 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', (end - start + 1).toString());
    createReadStream(video.filePath, { start, end }).pipe(res);
  }
}
