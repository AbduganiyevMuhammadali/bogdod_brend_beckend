const SaleModel             = require('./sale.model')
const SaleItemModel         = require('./sale_item.model')
const ClientModel           = require('./client.model')
const PurchaseModel         = require('./purchase.model')
const PurchaseItemModel     = require('./purchase_item.model')
const ProductModel          = require('./product.model')
const CashTransactionModel  = require('./cash_transaction.model')
const SupplierModel         = require('./supplier.model')

// Sale ↔ SaleItem
SaleModel.hasMany(SaleItemModel,   { foreignKey: 'sale_id',     as: 'items'    })
SaleItemModel.belongsTo(SaleModel, { foreignKey: 'sale_id',     as: 'sale'     })

// Sale ↔ Client
SaleModel.belongsTo(ClientModel,   { foreignKey: 'client_id',   as: 'client'   })

// Purchase ↔ PurchaseItem
PurchaseModel.hasMany(PurchaseItemModel,   { foreignKey: 'purchase_id', as: 'items'    })
PurchaseItemModel.belongsTo(PurchaseModel, { foreignKey: 'purchase_id', as: 'purchase' })

// PurchaseItem ↔ Product
PurchaseItemModel.belongsTo(ProductModel, { foreignKey: 'product_id', as: 'product' })
ProductModel.hasMany(PurchaseItemModel,   { foreignKey: 'product_id', as: 'batches' })

// CashTransaction ↔ Client
CashTransactionModel.belongsTo(ClientModel, { foreignKey: 'client_id', as: 'client' })

// Purchase ↔ Supplier
PurchaseModel.belongsTo(SupplierModel, { foreignKey: 'supplier_id', as: 'supplierRef' })
SupplierModel.hasMany(PurchaseModel,   { foreignKey: 'supplier_id', as: 'purchases'   })
