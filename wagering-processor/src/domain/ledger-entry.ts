import { Money } from './money.js';

export interface LedgerEntryProps {
  direction: 'CREDIT' | 'DEBIT';
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

/** Domain factory used before persistence; the database repeats these invariants with CHECKs. */
export class LedgerEntryDraft {
  static create(props: LedgerEntryProps): LedgerEntryProps {
    if (!props.amount.isPositive()) throw new RangeError('Lançamento deve ter valor positivo.');
    const expected = props.direction === 'CREDIT'
      ? props.balanceBefore.add(props.amount)
      : props.balanceBefore.subtract(props.amount);
    if (!expected.equals(props.balanceAfter)) throw new Error('Lançamento contábil não balanceado.');
    return Object.freeze({ ...props });
  }
}
