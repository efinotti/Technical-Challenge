import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { WageringService } from './wagering.service.js';
import { CreateWagerTransactionDto } from './dto/create-wager-transaction.dto.js';

@Controller('wagering')
export class WageringController {
  constructor(private readonly service: WageringService) {}

  @Post('transactions')
  createTransaction(@Body() dto: CreateWagerTransactionDto, @Headers('idempotency-key') idempotencyKey?: string) {
    if (!idempotencyKey) throw new BadRequestException('Informe o cabeçalho Idempotency-Key.');
    return this.service.createTransaction(dto, idempotencyKey);
  }

  @Get('transactions/:id') getTransaction(@Param('id', ParseUUIDPipe) id: string) { return this.service.getTransaction(id); }
  @Post('transactions/:id/process') processTransaction(@Param('id', ParseUUIDPipe) id: string) { return this.service.processTransaction(id); }
}
