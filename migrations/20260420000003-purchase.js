'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      // ── Purchase document ───────────────────────────────────────
      await queryInterface.createTable('purchase', {
        id:            { type: Sequelize.DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        doc_number:    { type: Sequelize.DataTypes.INTEGER, allowNull: false },
        date:          { type: Sequelize.DataTypes.DATE,    allowNull: false },
        warehouse:     { type: Sequelize.DataTypes.STRING(100), allowNull: false, defaultValue: 'Asosiy ombor' },
        supplier:      { type: Sequelize.DataTypes.STRING(200), allowNull: true },
        payment_type:  { type: Sequelize.DataTypes.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
        expense:       { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0 },
        discount:      { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0 },
        exchange_rate: { type: Sequelize.DataTypes.DECIMAL(12, 2), defaultValue: 11000 },
        comment:       { type: Sequelize.DataTypes.TEXT,  allowNull: true },
        status:        { type: Sequelize.DataTypes.ENUM('draft', 'confirmed', 'cancelled'), defaultValue: 'draft' },
        total_sum:     { type: Sequelize.DataTypes.DECIMAL(18, 2), defaultValue: 0 },
        total_usd:     { type: Sequelize.DataTypes.DECIMAL(15, 4), defaultValue: 0 },
        created_by:    { type: Sequelize.DataTypes.INTEGER, allowNull: true },
        createdAt:     { type: Sequelize.DataTypes.DATE },
        updatedAt:     { type: Sequelize.DataTypes.DATE },
        deletedAt:     { type: Sequelize.DataTypes.DATE },
      }, { transaction: t });

      // ── Purchase items (each row = 1 partiya) ───────────────────
      await queryInterface.createTable('purchase_item', {
        id:                  { type: Sequelize.DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        purchase_id:         { type: Sequelize.DataTypes.INTEGER, allowNull: false, references: { model: 'purchase', key: 'id' }, onDelete: 'CASCADE' },
        product_id:          { type: Sequelize.DataTypes.INTEGER, allowNull: true,  references: { model: 'product', key: 'id' }, onDelete: 'SET NULL' },
        barcode:             { type: Sequelize.DataTypes.STRING(100), allowNull: true },
        product_name:        { type: Sequelize.DataTypes.STRING(200), allowNull: false },
        stock_qty:           { type: Sequelize.DataTypes.DECIMAL(15, 3), defaultValue: 0,  comment: 'Snapshot of stock before this purchase' },

        pkg_qty:             { type: Sequelize.DataTypes.DECIMAL(15, 3), defaultValue: 0  },
        unit_qty:            { type: Sequelize.DataTypes.DECIMAL(15, 3), defaultValue: 0  },
        units_per_pkg:       { type: Sequelize.DataTypes.DECIMAL(10, 3), defaultValue: 1  },

        pkg_price:           { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0  },
        unit_price:          { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0  },
        cost_price:          { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0,  comment: 'Sebestoimost per unit incl. expense share' },

        total_sum:           { type: Sequelize.DataTypes.DECIMAL(18, 2), defaultValue: 0  },
        total_cost_sum:      { type: Sequelize.DataTypes.DECIMAL(18, 2), defaultValue: 0  },

        retail_markup_pct:   { type: Sequelize.DataTypes.DECIMAL(8, 2), defaultValue: 0   },
        wholesale_markup_pct:{ type: Sequelize.DataTypes.DECIMAL(8, 2), defaultValue: 0   },

        retail_price_sum:    { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0  },
        retail_price_usd:    { type: Sequelize.DataTypes.DECIMAL(15, 4), defaultValue: 0  },
        wholesale_price_sum: { type: Sequelize.DataTypes.DECIMAL(15, 2), defaultValue: 0  },
        wholesale_price_usd: { type: Sequelize.DataTypes.DECIMAL(15, 4), defaultValue: 0  },

        createdAt:     { type: Sequelize.DataTypes.DATE },
        updatedAt:     { type: Sequelize.DataTypes.DATE },
      }, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable('purchase_item', { transaction: t });
      await queryInterface.dropTable('purchase',      { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
