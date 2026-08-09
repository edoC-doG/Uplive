import { Module } from '@nestjs/common';
import { VideosModule } from '../videos/videos.module';
import { ExportService } from './export.service';
import { JobStoreService } from './job-store.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [VideosModule],
  controllers: [JobsController],
  providers: [JobStoreService, ExportService],
})
export class JobsModule {}
