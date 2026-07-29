module.exports = {
  up: async (qi, Sequelize) => {
    const dt = Sequelize.DataTypes

    // Add sold_qty to purchase_item for FIFO tracking
    await qi.addColumn('purchase_item', 'sold_qty', {
      type: dt.DECIMAL(15, 3), defaultValue: 0, allowNull: false, after: 'unit_qty',
    })

    // Clients (mijozlar)
    await qi.createTable('client', {
      id:         { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      code:       { type: dt.STRING(30), allowNull: true },
      name:       { type: dt.STRING(200), allowNull: false },
      phone:      { type: dt.STRING(30), allowNull: true },
      address:    { type: dt.TEXT, allowNull: true },
      balance:    { type: dt.DECIMAL(18, 2), defaultValue: 0 }, // negative = owes us
      comment:    { type: dt.TEXT, allowNull: true },
      active:     { type: dt.BOOLEAN, defaultValue: true },
      created_at: { type: dt.DATE },
      updated_at: { type: dt.DATE },
    })

    // Sales (sotuv)
    await qi.createTable('sale', {
      id:           { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      doc_number:   { type: dt.INTEGER },
      date:         { type: dt.DATE },
      warehouse:    { type: dt.STRING(100), defaultValue: 'Asosiy ombor' },
      client_id:    { type: dt.INTEGER, allowNull: true,
                      references: { model: 'client', key: 'id' }, onDelete: 'SET NULL' },
      payment_type: { type: dt.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
      price_type:   { type: dt.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
      total_sum:    { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      discount:     { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      paid_sum:     { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      debt_sum:     { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      cashier_id:   { type: dt.INTEGER, allowNull: true },
      status:       { type: dt.ENUM('draft', 'completed', 'cancelled'), defaultValue: 'completed' },
      comment:      { type: dt.TEXT, allowNull: true },
      created_at:   { type: dt.DATE },
      updated_at:   { type: dt.DATE },
    })

    // Sale items
    await qi.createTable('sale_item', {
      id:               { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      sale_id:          { type: dt.INTEGER, allowNull: false,
                          references: { model: 'sale', key: 'id' }, onDelete: 'CASCADE' },
      product_id:       { type: dt.INTEGER, allowNull: true,
                          references: { model: 'product', key: 'id' }, onDelete: 'SET NULL' },
      purchase_item_id: { type: dt.INTEGER, allowNull: true }, // FIFO: which batch
      barcode:          { type: dt.STRING(100), allowNull: true },
      product_name:     { type: dt.STRING(300), allowNull: false },
      qty:              { type: dt.DECIMAL(10, 3), defaultValue: 0 },
      price:            { type: dt.DECIMAL(15, 2), defaultValue: 0 },
      total_sum:        { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      price_type:       { type: dt.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
      created_at:       { type: dt.DATE },
      updated_at:       { type: dt.DATE },
    })

    // Cash transactions (kassa)
    await qi.createTable('cash_transaction', {
      id:             { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      date:           { type: dt.DATE },
      type:           { type: dt.ENUM('income', 'expense', 'sale', 'refund', 'debt_payment', 'opening') },
      amount:         { type: dt.DECIMAL(18, 2), defaultValue: 0 },
      payment_type:   { type: dt.ENUM('Naqd', 'Karta', "O'tkazma"), defaultValue: 'Naqd' },
      reference_id:   { type: dt.INTEGER, allowNull: true },
      reference_type: { type: dt.STRING(50), allowNull: true },
      client_id:      { type: dt.INTEGER, allowNull: true },
      description:    { type: dt.TEXT, allowNull: true },
      cashier_id:     { type: dt.INTEGER, allowNull: true },
      created_at:     { type: dt.DATE },
      updated_at:     { type: dt.DATE },
    })
  },

  down: async (qi) => {
    await qi.dropTable('cash_transaction')
    await qi.dropTable('sale_item')
    await qi.dropTable('sale')
    await qi.dropTable('client')
    await qi.removeColumn('purchase_item', 'sold_qty')
  },
}
