const transactionService = require('../services/transaction.service');

class TransactionController {
  /**
   * POST /transactions
   */
  async createTransaction(req, res, next) {
    try {
      const result = await transactionService.ingestSingleTransaction(req.body);
      return res.status(result.statusCode).json(result.data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /transactions/batch
   */
  async createBatchTransactions(req, res, next) {
    try {
      const result = await transactionService.ingestBatchTransactions(req.body);
      return res.status(result.statusCode).json(result.data);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TransactionController();
