import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { VideoStoreService } from './video-store.service';
import { YoutubeService } from './youtube.service';

@Module({
  controllers: [VideosController],
  providers: [VideoStoreService, YoutubeService],
  exports: [VideoStoreService],
})
export class VideosModule {}
