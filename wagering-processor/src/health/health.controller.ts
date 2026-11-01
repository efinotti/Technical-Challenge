import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SqsGateway } from '../messaging/sqs-gateway.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly em: EntityManager, private readonly sqs: SqsGateway) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() {
    let postgres: 'ok' | 'unavailable' = 'ok';
    let sqs: 'ok' | 'disabled' | 'unavailable' = this.sqs.enabled ? 'ok' : 'disabled';
    try { await this.em.getConnection().execute('select 1'); } catch { postgres = 'unavailable'; }
    if (!(await this.sqs.checkConnection())) sqs = 'unavailable';
    if (postgres !== 'ok' || sqs === 'unavailable') {
      throw new ServiceUnavailableException({ status: 'unavailable', dependencies: { postgres, sqs } });
    }
    return { status: 'ok', dependencies: { postgres, sqs } };
  }
}
