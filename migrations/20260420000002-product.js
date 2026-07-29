'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('product', {
        id: {
          type: Sequelize.DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        code: {
          type: Sequelize.DataTypes.STRING(50),
          allowNull: true,
          unique: true,
        },
        name: {
          type: Sequelize.DataTypes.STRING(200),
          allowNull: false,
        },
        general_name: {
          type: Sequelize.DataTypes.STRING(200),
          allowNull: true,
        },
        unit: {
          type: Sequelize.DataTypes.STRING(30),
          allowNull: true,
          defaultValue: 'Dona',
        },
        brand: {
          type: Sequelize.DataTypes.STRING(100),
          allowNull: true,
        },
        model: {
          type: Sequelize.DataTypes.STRING(100),
          allowNull: true,
        },
        country: {
          type: Sequelize.DataTypes.STRING(100),
          allowNull: true,
        },
        category: {
          type: Sequelize.DataTypes.STRING(100),
          allowNull: true,
        },
        color: {
          type: Sequelize.DataTypes.STRING(50),
          allowNull: true,
        },
        extra_name1: { type: Sequelize.DataTypes.STRING(200), allowNull: true },
        extra_name2: { type: Sequelize.DataTypes.STRING(200), allowNull: true },
        extra_name3: { type: Sequelize.DataTypes.STRING(200), allowNull: true },
        barcodes: {
          type: Sequelize.DataTypes.TEXT,
          allowNull: true,
          comment: 'JSON array of barcode strings',
        },
        photo: {
          type: Sequelize.DataTypes.STRING(500),
          allowNull: true,
        },
        wholesale_price: {
          type: Sequelize.DataTypes.DECIMAL(15, 2),
          allowNull: true,
          defaultValue: 0,
        },
        wholesale_price_usd: {
          type: Sequelize.DataTypes.DECIMAL(15, 4),
          allowNull: true,
          defaultValue: 0,
        },
        retail_price: {
          type: Sequelize.DataTypes.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        retail_price_usd: {
          type: Sequelize.DataTypes.DECIMAL(15, 4),
          allowNull: true,
          defaultValue: 0,
        },
        currency: {
          type: Sequelize.DataTypes.STRING(10),
          allowNull: true,
          defaultValue: "So'm",
        },
        qty: {
          type: Sequelize.DataTypes.DECIMAL(15, 3),
          allowNull: false,
          defaultValue: 0,
        },
        min_qty: {
          type: Sequelize.DataTypes.DECIMAL(15, 3),
          allowNull: true,
          defaultValue: 0,
        },
        is_folder: {
          type: Sequelize.DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        active: {
          type: Sequelize.DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        createdAt: { type: Sequelize.DataTypes.DATE },
        updatedAt: { type: Sequelize.DataTypes.DATE },
        deletedAt: { type: Sequelize.DataTypes.DATE },
      }, { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable('product', { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
