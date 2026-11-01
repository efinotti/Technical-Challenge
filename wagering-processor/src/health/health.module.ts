import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module.js';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics.controller.js';

@Module({ imports: [MessagingModule], controllers: [HealthController, MetricsController] })
export class HealthModule {}
