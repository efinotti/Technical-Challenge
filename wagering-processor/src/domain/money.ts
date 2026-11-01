/** Exact, immutable monetary value. Never converts through JavaScript number. */
export interface MoneyProps {
  amount: string;
  currency: string;
}

const MONEY_PATTERN = /^(0|[1-9]\d{0,16})(?:\.(\d{1,2}))?$/;

export class Money {
  private constructor(
    private readonly minorUnits: bigint,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (!props || typeof props.amount !== 'string') {
      throw new TypeError('Money.amount deve ser uma string decimal.');
    }
    const currency = props.currency?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new TypeError('Moeda inválida: esperado código ISO-4217.');
    }
    const value = props.amount.trim();
    const match = MONEY_PATTERN.exec(value);
    if (!match) {
      throw new TypeError('Valor monetário inválido; use decimal positivo com até 2 casas.');
    }
    const whole = BigInt(match[1]);
    const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
    const minorUnits = whole * 100n + fraction;
    if (minorUnits > 10n ** 19n - 1n) throw new RangeError('Valor excede numeric(19,2).');
    return new Money(minorUnits, currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    if (minorUnits < 0n) throw new RangeError('Dinheiro não pode ser negativo.');
    const normalizedCurrency = currency?.trim().toUpperCase();
    if (!normalizedCurrency || !/^[A-Z]{3}$/.test(normalizedCurrency)) throw new TypeError('Moeda inválida.');
    if (minorUnits > 10n ** 19n - 1n) throw new RangeError('Valor excede numeric(19,2).');
    return new Money(minorUnits, normalizedCurrency);
  }

  add(other: Money): Money {
    this.assertCurrency(other);
    const result = this.minorUnits + other.minorUnits;
    if (result > 10n ** 19n - 1n) throw new RangeError('Valor excede numeric(19,2).');
    return new Money(result, this.currency);
  }

  subtract(other: Money): Money {
    this.assertCurrency(other);
    const value = this.minorUnits - other.minorUnits;
    if (value < 0n) throw new RangeError('Saldo insuficiente.');
    return new Money(value, this.currency);
  }

  negate(): Money {
    if (this.minorUnits === 0n) return this;
    return new Money(-this.minorUnits, this.currency);
  }

  isZero(): boolean { return this.minorUnits === 0n; }
  isPositive(): boolean { return this.minorUnits > 0n; }
  isNegative(): boolean { return this.minorUnits < 0n; }

  isLessThan(other: Money): boolean {
    this.assertCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  toMinorUnits(): bigint { return this.minorUnits; }

  toString(): string {
    const sign = this.minorUnits < 0n ? '-' : '';
    const absolute = this.minorUnits < 0n ? -this.minorUnits : this.minorUnits;
    return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  toJSON(): MoneyProps { return { amount: this.toString(), currency: this.currency }; }

  private assertCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new TypeError('Não é permitido operar com moedas diferentes.');
  }
}
