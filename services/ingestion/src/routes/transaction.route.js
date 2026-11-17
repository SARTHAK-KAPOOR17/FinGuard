const { Router } = require('express');
const transactionController = require('../controllers/transaction.controller');

const router = Router();

router.post('/', transactionController.createTransaction);
router.post('/batch', transactionController.createBatchTransactions);

module.exports = router;
