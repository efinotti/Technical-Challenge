import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { CreateWalletDto } from './dto/create-wallet-dto.js';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}
  @Get(':id') getWallet(@Param('id', ParseUUIDPipe) id: string) { return this.walletService.getWallet(id); }
  @Post() createWallet(@Body() walletData: CreateWalletDto) { return this.walletService.createWallet(walletData); }
  @Get(':id/ledger') getLedger(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException('limit deve ser um inteiro positivo.');
    return this.walletService.getLedger(id, parsed, cursor);
  }
  @Get(':id/reconciliation') reconcile(@Param('id', ParseUUIDPipe) id: string) { return this.walletService.reconcile(id); }
}
