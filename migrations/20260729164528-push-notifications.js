module.exports = {
  up: async (qi, Sequelize) => {
    const dt = Sequelize.DataTypes

    // Har bir brauzer/qurilma push obunasi (bir foydalanuvchi bir nechta qurilmadan kirishi mumkin)
    await qi.createTable('push_subscription', {
      id:         { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:    { type: dt.INTEGER, allowNull: true,
                    references: { model: 'user', key: 'id' }, onDelete: 'CASCADE' },
      endpoint:   { type: dt.STRING(700), allowNull: false, unique: true },
      p256dh:     { type: dt.STRING(200), allowNull: false },
      auth:       { type: dt.STRING(100), allowNull: false },
      created_at: { type: dt.DATE },
      updated_at: { type: dt.DATE },
    })

    // Global tizim sozlamalari — kalit/qiymat (bildirishnoma vaqti va h.k.)
    await qi.createTable('app_setting', {
      id:         { type: dt.INTEGER, primaryKey: true, autoIncrement: true },
      key:        { type: dt.STRING(100), allowNull: false, unique: true },
      value:      { type: dt.TEXT, allowNull: true },
      created_at: { type: dt.DATE },
      updated_at: { type: dt.DATE },
    })

    await qi.bulkInsert('app_setting', [
      { key: 'daily_notification_enabled', value: 'true',  created_at: new Date(), updated_at: new Date() },
      { key: 'daily_notification_time',    value: '08:00', created_at: new Date(), updated_at: new Date() },
    ])
  },

  down: async (qi) => {
    await qi.dropTable('app_setting')
    await qi.dropTable('push_subscription')
  },
}
