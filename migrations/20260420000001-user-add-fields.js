'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn('user', 'email', {
        type: Sequelize.DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      }, { transaction });

      await queryInterface.addColumn('user', 'warehouse', {
        type: Sequelize.DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      }, { transaction });

      await queryInterface.addColumn('user', 'permissions', {
        type: Sequelize.DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      }, { transaction });

      await queryInterface.addColumn('user', 'active', {
        type: Sequelize.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      await queryInterface.removeColumn('user', 'email',       { transaction });
      await queryInterface.removeColumn('user', 'warehouse',   { transaction });
      await queryInterface.removeColumn('user', 'permissions', { transaction });
      await queryInterface.removeColumn('user', 'active',      { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
