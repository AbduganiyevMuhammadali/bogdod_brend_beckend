const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/purchase.controller');
const auth    = require('../middleware/auth.middleware');
const awaitHF = require('../middleware/awaitHandlerFactory.middleware');
const perm    = require('../middleware/perm.middleware');

router.get('/next-number',   auth(), awaitHF(ctrl.getNextDocNumber));
router.get('/fifo-prices',   auth(), awaitHF(ctrl.getFifoPrices));
router.get('/batches',       auth(), awaitHF(ctrl.getBatches));
router.get('/',              auth(), awaitHF(ctrl.getAll));
router.get('/:id',           auth(), awaitHF(ctrl.getById));
router.post('/',             auth(), perm('purchases', 'qoshish'), awaitHF(ctrl.create));
router.put('/:id',           auth(), perm('purchases', 'tahrir'),  awaitHF(ctrl.update));
router.patch('/:id/items/:itemId/prices', auth(), perm('purchases', 'tahrir'), awaitHF(ctrl.updateItemPrices));
router.post('/:id/confirm',  auth(), perm('purchases', 'qoshish'), awaitHF(ctrl.confirm));
router.post('/:id/cancel',   auth(), perm('purchases', 'tahrir'),  awaitHF(ctrl.cancel));
router.delete('/:id',        auth(), perm('purchases', 'tahrir'),  awaitHF(ctrl.delete));

module.exports = router;
