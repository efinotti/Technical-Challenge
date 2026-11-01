import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export enum TransactionTypeDto {
  BET = 'BET', WIN = 'WIN', LOSS = 'LOSS', REFUND = 'REFUND', ROLLBACK = 'ROLLBACK',
}

export class CreateWagerTransactionDto {
  @IsString() @IsNotEmpty() @MaxLength(120) providerId!: string;
  @IsUUID() walletId!: string;
  @IsString() @Matches(/^[A-Z]{3}$/i) currency!: string;
  @IsEnum(TransactionTypeDto) type!: TransactionTypeDto;
  @IsString() @Matches(/^(0|[1-9]\d{0,16})(\.\d{1,2})?$/) amount!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) externalTransactionId!: string;
  @IsOptional() @IsString() @MaxLength(120) roundId?: string;
  @IsOptional() @IsString() @MaxLength(120) gameId?: string;
  @IsOptional() @IsString() @MaxLength(255) referenceExternalTransactionId?: string;
}
