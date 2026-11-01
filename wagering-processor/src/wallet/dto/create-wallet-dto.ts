import { IsDefined, IsNotEmpty, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class InitialBalanceDto {
  @IsString() @Matches(/^(0|[1-9]\d{0,16})(\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(/^[A-Z]{3}$/i) currency!: string;
}

export class CreateWalletDto {
  @IsString() @IsNotEmpty() @MaxLength(120) playerId!: string;
  @IsDefined() @ValidateNested() @Type(() => InitialBalanceDto) initialBalance!: InitialBalanceDto;
}
