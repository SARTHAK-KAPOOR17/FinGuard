const { SEED_RULES } = require('../rules/seed-rules');

class RuleEvaluator {
  /**
   * @param {Array} [initialRules]
   */
  constructor(initialRules = SEED_RULES) {
    this.rules = [...initialRules];
  }

  /**
   * Evaluates a transaction against all active rules.
   *
   * @param {object} txn
   * @returns {{ isFlagged: boolean, matchedRules: Array<object>, riskScore: number }}
   */
  evaluate(txn) {
    const matchedRules = [];
    let calculatedScore = 0;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      try {
        const result = rule.evaluate(txn);
        if (result && result.matched) {
          matchedRules.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            reason: result.reason || `${rule.name} matched`,
            metadata: result.metadata || {},
          });

          switch (rule.severity) {
            case 'CRITICAL':
              calculatedScore += 50;
              break;
            case 'HIGH':
              calculatedScore += 35;
              break;
            case 'MEDIUM':
              calculatedScore += 20;
              break;
            case 'LOW':
            default:
              calculatedScore += 10;
              break;
          }
        }
      } catch (err) {
        // Individual rule failure should not crash the entire evaluation
        continue;
      }
    }

    const isFlagged = matchedRules.length > 0;
    const riskScore = isFlagged ? Math.min(100, Math.max(50, calculatedScore)) : 0;

    return {
      isFlagged,
      matchedRules,
      riskScore,
    };
  }

  getRules() {
    return this.rules.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      severity: r.severity,
      enabled: r.enabled,
    }));
  }

  setRuleEnabled(ruleId, enabled) {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = Boolean(enabled);
      return true;
    }
    return false;
  }
}

module.exports = {
  RuleEvaluator,
};
