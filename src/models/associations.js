const SaleModel             = require('./sale.model')
const SaleItemModel         = require('./sale_item.model')
const ClientModel           = require('./client.model')
const PurchaseModel         = require('./purchase.model')
const PurchaseItemModel     = require('./purchase_item.model')
const ProductModel          = require('./product.model')
const CashTransactionModel  = require('./cash_transaction.model')
const SupplierModel         = require('./supplier.model')
const InventoryModel        = require('./inventory.model')
const InventoryItemModel    = require('./inventory_item.model')
const UserModel             = require('./user.model')

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

// Purchase ↔ User (kim yaratgan) — tezkor kiritish tarixida ko'rsatiladi
PurchaseModel.belongsTo(UserModel, { foreignKey: 'created_by', as: 'creator' })
// Yorliqni kim chop etgan
PurchaseModel.belongsTo(UserModel, { foreignKey: 'labels_printed_by', as: 'printer' })

// Purchase ↔ Supplier
PurchaseModel.belongsTo(SupplierModel, { foreignKey: 'supplier_id', as: 'supplierRef' })
SupplierModel.hasMany(PurchaseModel,   { foreignKey: 'supplier_id', as: 'purchases'   })

// Inventory ↔ InventoryItem
InventoryModel.hasMany(InventoryItemModel,   { foreignKey: 'inventory_id', as: 'items'     })
InventoryItemModel.belongsTo(InventoryModel, { foreignKey: 'inventory_id', as: 'inventory' })

// InventoryItem ↔ Product
InventoryItemModel.belongsTo(ProductModel, { foreignKey: 'product_id', as: 'product' })
