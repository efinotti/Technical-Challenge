import { Controller, Get, Param } from '@nestjs/common';
import { WageringService } from './wagering.service.js';

@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionController {
  constructor(private readonly service: WageringService) {}
  @Get(':externalTransactionId')
  getByExternalId(@Param('providerId') providerId: string, @Param('externalTransactionId') externalTransactionId: string) {
    return this.service.getProviderTransaction(providerId, externalTransactionId);
  }
}
