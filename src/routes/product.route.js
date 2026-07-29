const express  = require('express');
const router   = express.Router();
const path     = require('path');
const multer   = require('multer');
const ctrl     = require('../controllers/product.controller');
const auth     = require('../middleware/auth.middleware');
const awaitHF  = require('../middleware/awaitHandlerFactory.middleware');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

// GET /api/v1/products?search=&category=&page=&limit=
const perm = require('../middleware/perm.middleware');

router.get('/',                auth(), awaitHF(ctrl.getAll));
router.get('/categories',      auth(), awaitHF(ctrl.getCategories));
router.get('/low-stock-count', auth(), awaitHF(ctrl.getLowStockCount));
router.get('/by-barcode/:code',auth(), awaitHF(ctrl.getByBarcode));
router.get('/:id',             auth(), awaitHF(ctrl.getById));

// POST /api/v1/products/upload  (photo upload)
router.post('/upload',        auth(), perm('products', 'qoshish'), upload.single('photo'), awaitHF(ctrl.uploadPhoto));

// POST /api/v1/products
router.post('/',              auth(), perm('products', 'qoshish'), awaitHF(ctrl.create));

// PUT /api/v1/products/:id   (full update)
router.put('/:id',            auth(), perm('products', 'tahrir'), awaitHF(ctrl.update));

// PATCH /api/v1/products/:id (partial update)
router.patch('/:id',          auth(), perm('products', 'tahrir'), awaitHF(ctrl.patch));

// DELETE /api/v1/products/:id
router.delete('/:id',         auth(), perm('products', 'tahrir'), awaitHF(ctrl.delete));

module.exports = router;
