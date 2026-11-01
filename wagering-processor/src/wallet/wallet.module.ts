
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { Wallet } from './entities/wallet.entity.js';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([Wallet])
  ],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
