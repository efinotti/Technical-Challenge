import { describe, expect, it } from 'bun:test';
import { Money } from './money.js';
import { LedgerEntryDraft } from './ledger-entry.js';
import { WalletAccount } from './wallet.aggregate.js';

describe('Money', () => {
  it('normalizes decimal strings to exactly two places', () => {
    expect(Money.from({ amount: '12.5', currency: 'brl' }).toJSON()).toEqual({ amount: '12.50', currency: 'BRL' });
  });
  it('does exact arithmetic beyond Number safe integer range', () => {
    const a = Money.from({ amount: '900719925474099.01', currency: 'BRL' });
    const b = Money.from({ amount: '0.99', currency: 'BRL' });
    expect(a.add(b).toString()).toBe('900719925474100.00');
  });
  it('rejects more than two decimals, exponent notation and negatives', () => {
    for (const amount of ['1.001', '1e3', '-1.00', 'NaN', '']) {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow();
    }
  });
  it('rejects a currency mismatch', () => {
    expect(() => Money.from({ amount: '1.00', currency: 'BRL' }).add(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow(/moedas diferentes/i);
  });
  it('prevents negative balance', () => {
    expect(() => Money.from({ amount: '1.00', currency: 'BRL' }).subtract(Money.from({ amount: '1.01', currency: 'BRL' }))).toThrow(/Saldo insuficiente/);
  });
  it('encapsulates wallet debit, credit and version invariants', () => {
    const wallet = WalletAccount.rehydrate({ id: 'wallet-1', currency: 'BRL', balance: '10.00', version: 1 });
    const debit = wallet.debit(Money.from({ amount: '3.00', currency: 'BRL' }));
    expect(debit.account.balance.toString()).toBe('7.00');
    expect(debit.account.version).toBe(2);
    const credit = debit.account.credit(Money.from({ amount: '2.00', currency: 'BRL' }));
    expect(credit.account.balance.toString()).toBe('9.00');
    expect(credit.account.version).toBe(3);
  });
  it('validates ledger arithmetic', () => {
    expect(() => LedgerEntryDraft.create({ direction: 'DEBIT', amount: Money.from({ amount: '2.00', currency: 'BRL' }), balanceBefore: Money.from({ amount: '5.00', currency: 'BRL' }), balanceAfter: Money.from({ amount: '4.00', currency: 'BRL' }) })).toThrow(/não balanceado/);
  });
});
