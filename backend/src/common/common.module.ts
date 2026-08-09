import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { TaskQueueService } from './task-queue.service';

@Global()
@Module({
  providers: [StorageService, TaskQueueService],
  exports: [StorageService, TaskQueueService],
})
export class CommonModule {}
