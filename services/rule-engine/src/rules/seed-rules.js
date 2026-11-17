/**
 * FinGuard Rule Definitions
 */
const SEED_RULES = [
  {
    id: 'RULE_LARGE_AMOUNT',
    name: 'High Transaction Amount',
    description: 'Flags transactions with amount strictly greater than $10,000 USD',
    type: 'THRESHOLD',
    severity: 'HIGH',
    enabled: true,
    threshold: 10000,
    currency: 'USD',
    evaluate(txn) {
      if (txn.amount > this.threshold && txn.currency === this.currency) {
        return {
          matched: true,
          reason: `Transaction amount of $${txn.amount.toFixed(2)} ${txn.currency} exceeds threshold of $${this.threshold.toLocaleString()} ${this.currency}`,
          metadata: {
            amount: txn.amount,
            threshold: this.threshold,
            currency: txn.currency,
          },
        };
      }
      return { matched: false };
    },
  },
  {
    id: 'RULE_SUSPICIOUS_MERCHANT',
    name: 'Suspicious High-Risk Merchant Match',
    description: 'Flags transactions with merchant names matching known high-risk luxury, offshore, or gambling keywords',
    type: 'REGEX',
    severity: 'CRITICAL',
    enabled: true,
    pattern: /(Rolex Boutique|Private Jet Charter|Diamond Exchange|Offshore Crypto OTC|Luxury Motors Geneva|High Stakes Casino VIP)/i,
    evaluate(txn) {
      if (this.pattern.test(txn.merchant)) {
        return {
          matched: true,
          reason: `Merchant "${txn.merchant}" matches high-risk merchant pattern`,
          metadata: {
            merchant: txn.merchant,
            matchedPattern: this.pattern.source,
          },
        };
      }
      return { matched: false };
    },
  },
];

module.exports = {
  SEED_RULES,
};
