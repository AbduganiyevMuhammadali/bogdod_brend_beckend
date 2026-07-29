const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class ProductModel extends Model {}

ProductModel.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
  },
  code:         { type: DataTypes.STRING(50),  allowNull: true  },
  name:         { type: DataTypes.STRING(200), allowNull: false },
  general_name: { type: DataTypes.STRING(200), allowNull: true  },
  unit:         { type: DataTypes.STRING(30),  allowNull: true, defaultValue: 'Dona' },
  brand:        { type: DataTypes.STRING(100), allowNull: true  },
  model:        { type: DataTypes.STRING(100), allowNull: true  },
  country:      { type: DataTypes.STRING(100), allowNull: true  },
  category:     { type: DataTypes.STRING(100), allowNull: true  },
  color:        { type: DataTypes.STRING(50),  allowNull: true  },
  extra_name1:  { type: DataTypes.STRING(200), allowNull: true  },
  extra_name2:  { type: DataTypes.STRING(200), allowNull: true  },
  extra_name3:  { type: DataTypes.STRING(200), allowNull: true  },
  barcodes: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('barcodes');
      try { return raw ? JSON.parse(raw) : []; } catch { return []; }
    },
    set(val) {
      this.setDataValue('barcodes', Array.isArray(val) ? JSON.stringify(val) : null);
    },
  },
  photo:               { type: DataTypes.STRING(500), allowNull: true },
  wholesale_price:     { type: DataTypes.DECIMAL(15, 2), allowNull: true,  defaultValue: 0 },
  wholesale_price_usd: { type: DataTypes.DECIMAL(15, 4), allowNull: true,  defaultValue: 0 },
  retail_price:        { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
  retail_price_usd:    { type: DataTypes.DECIMAL(15, 4), allowNull: true,  defaultValue: 0 },
  currency:            { type: DataTypes.STRING(10),     allowNull: true,  defaultValue: "So'm" },
  qty:     { type: DataTypes.DECIMAL(15, 3), allowNull: false, defaultValue: 0 },
  min_qty: { type: DataTypes.DECIMAL(15, 3), allowNull: true,  defaultValue: 0 },
  is_folder: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  active:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true  },
}, {
  sequelize,
  modelName: 'ProductModel',
  tableName: 'product',
  timestamps: true,
  paranoid: true,
});

module.exports = ProductModel;
