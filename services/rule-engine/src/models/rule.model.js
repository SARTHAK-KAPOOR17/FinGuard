const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema(
  {
    ruleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'THRESHOLD',
        'REGEX',
        'VELOCITY',
        'GEO_DISTANCE',
        'amount_threshold',
        'merchant_regex',
        'velocity',
        'geo_jump',
      ],
    },
    severity: {
      type: String,
      required: true,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'HIGH',
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'rules',
  }
);

const Rule = mongoose.models.Rule || mongoose.model('Rule', ruleSchema);

module.exports = { Rule };
