module.exports = {
  up: async (qi, Sequelize) => {
    const dt = Sequelize.DataTypes

    // product_register — one row per sold item, for product movement reports
    await qi.createTable('product_register', {
      id:            { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      date:          { type: dt.DATE },
      sale_id:       { type: dt.INTEGER, allowNull: true,
                       references: { model: 'sale', key: 'id' }, onDelete: 'SET NULL' },
      doc_number:    { type: dt.INTEGER, allowNull: true },
      warehouse:     { type: dt.STRING(100), defaultValue: 'Asosiy ombor' },
      product_id:    { type: dt.INTEGER, allowNull: true,
                       references: { model: 'product', key: 'id' }, onDelete: 'SET NULL' },
      product_name:  { type: dt.STRING(300), allowNull: false },
      barcode:       { type: dt.STRING(100), allowNull: true },
      qty:           { type: dt.DECIMAL(10, 3), defaultValue: 0 },
      price:         { type: dt.DECIMAL(15, 2), defaultValue: 0 },
      price_type:    { type: dt.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
      total_sum:     { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      cashier_id:    { type: dt.INTEGER, allowNull: true },
      cashier_name:  { type: dt.STRING(100), allowNull: true },
      status:        { type: dt.ENUM('active', 'reversed'), defaultValue: 'active' },
      created_at:    { type: dt.DATE },
      updated_at:    { type: dt.DATE },
    })

    // kassa_register — one row per sale, for cash register (kassa) reports
    await qi.createTable('kassa_register', {
      id:            { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      date:          { type: dt.DATE },
      sale_id:       { type: dt.INTEGER, allowNull: true,
                       references: { model: 'sale', key: 'id' }, onDelete: 'SET NULL' },
      doc_number:    { type: dt.INTEGER, allowNull: true },
      warehouse:     { type: dt.STRING(100), defaultValue: 'Asosiy ombor' },
      payment_type:  { type: dt.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
      price_type:    { type: dt.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
      total_sum:     { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      paid_sum:      { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      debt_sum:      { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      discount:      { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      item_count:    { type: dt.INTEGER, defaultValue: 0 },
      client_id:     { type: dt.INTEGER, allowNull: true },
      client_name:   { type: dt.STRING(200), allowNull: true },
      cashier_id:    { type: dt.INTEGER, allowNull: true },
      cashier_name:  { type: dt.STRING(100), allowNull: true },
      status:        { type: dt.ENUM('completed', 'cancelled'), defaultValue: 'completed' },
      created_at:    { type: dt.DATE },
      updated_at:    { type: dt.DATE },
    })
  },

  down: async (qi) => {
    await qi.dropTable('kassa_register')
    await qi.dropTable('product_register')
  },
}
