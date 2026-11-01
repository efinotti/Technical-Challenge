import { Money } from './money.js';

export interface WalletState {
  id: string;
  currency: string;
  balance: string;
  version: number;
}

export interface WalletMovement {
  direction: 'CREDIT' | 'DEBIT';
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  versionBefore: number;
  versionAfter: number;
}

/** Domain aggregate for wallet invariants. Persistence entities are only the storage mapping. */
export class WalletAccount {
  private constructor(
    public readonly id: string,
    public readonly currency: string,
    private readonly currentBalance: Money,
    public readonly version: number,
  ) {}

  static rehydrate(state: WalletState): WalletAccount {
    if (!Number.isInteger(state.version) || state.version < 1) throw new RangeError('Versão de carteira inválida.');
    return new WalletAccount(state.id, state.currency, Money.from({ amount: state.balance, currency: state.currency }), state.version);
  }

  get balance(): Money { return this.currentBalance; }

  debit(amount: Money): { account: WalletAccount; movement: WalletMovement } {
    this.assertCurrency(amount);
    const after = this.currentBalance.subtract(amount);
    return this.change('DEBIT', amount, after);
  }

  credit(amount: Money): { account: WalletAccount; movement: WalletMovement } {
    this.assertCurrency(amount);
    if (!amount.isPositive()) throw new RangeError('Crédito deve ser positivo.');
    const after = this.currentBalance.add(amount);
    return this.change('CREDIT', amount, after);
  }

  private change(direction: 'CREDIT' | 'DEBIT', amount: Money, after: Money) {
    const movement: WalletMovement = Object.freeze({
      direction, amount, balanceBefore: this.currentBalance, balanceAfter: after,
      versionBefore: this.version, versionAfter: this.version + 1,
    });
    const account = new WalletAccount(this.id, this.currency, after, movement.versionAfter);
    return { account, movement };
  }

  private assertCurrency(amount: Money): void {
    if (amount.currency !== this.currency) throw new TypeError('Moeda da operação diferente da carteira.');
    if (!amount.isPositive()) throw new RangeError('Movimentação deve ser positiva.');
  }
}
