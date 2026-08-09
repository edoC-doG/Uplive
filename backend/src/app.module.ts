import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CommonModule } from './common/common.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { VideosModule } from './videos/videos.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    CommonModule,
    VideosModule,
    JobsModule,
    // Serves the built React app. No SPA fallback is needed since the frontend
    // has no client-side routing - unmatched paths (incl. bad /api/* routes)
    // fall through to Nest's normal 404 handling.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
