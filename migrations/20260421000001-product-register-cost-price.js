'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_register', 'cost_price', {
      type: Sequelize.DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
      allowNull: false,
      after: 'price',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_register', 'cost_price');
  },
};
