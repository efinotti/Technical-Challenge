import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { WalletModule } from './wallet/wallet.module.js';
import { Wallet } from './wallet/entities/wallet.entity.js';
import { WageringModule } from './wagering/wagering.module.js';
import { WagerTransaction } from './wagering/entities/wager-transaction.entity.js';
import { LedgerEntry } from './wagering/entities/ledger-entry.entity.js';
import { InboxMessage } from './messaging/entities/inbox-message.entity.js';
import { OutboxMessage } from './messaging/entities/outbox-message.entity.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { HealthModule } from './health/health.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRootAsync({
      imports: [ConfigModule], inject: [ConfigService], driver: PostgreSqlDriver,
      useFactory: (config: ConfigService) => ({
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.get<string>('DB_PORT') ?? 5432),
        user: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        dbName: config.getOrThrow<string>('DB_NAME'),
        entities: [Wallet, WagerTransaction, LedgerEntry, InboxMessage, OutboxMessage],
        allowGlobalContext: false,
        debug: config.get<string>('MIKRO_ORM_DEBUG') === 'true',
      }),
    }),
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'disabled',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'disabled',
      serviceId: 'wagering-processor',
    }),
    WalletModule, WageringModule, MessagingModule, HealthModule,
  ],
  controllers: [AppController], providers: [AppService],
})
export class AppModule {}
