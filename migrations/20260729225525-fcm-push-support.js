module.exports = {
  up: async (qi, Sequelize) => {
    const dt = Sequelize.DataTypes

    // Android/FCM qurilmalar uchun token — Web Push endpoint'idan farqli, bitta string.
    await qi.addColumn('push_subscription', 'fcm_token', {
      type: dt.STRING(400), allowNull: true, unique: true,
    })

    // Endi ikki turdagi obuna bo'lishi mumkin: Web Push (endpoint/p256dh/auth)
    // yoki FCM (fcm_token). Shuning uchun eski maydonlar endi majburiy emas.
    await qi.changeColumn('push_subscription', 'endpoint', { type: dt.STRING(700), allowNull: true })
    await qi.changeColumn('push_subscription', 'p256dh',   { type: dt.STRING(200), allowNull: true })
    await qi.changeColumn('push_subscription', 'auth',     { type: dt.STRING(100), allowNull: true })
  },

  down: async (qi, Sequelize) => {
    const dt = Sequelize.DataTypes
    await qi.removeColumn('push_subscription', 'fcm_token')
    await qi.changeColumn('push_subscription', 'endpoint', { type: dt.STRING(700), allowNull: false })
    await qi.changeColumn('push_subscription', 'p256dh',   { type: dt.STRING(200), allowNull: false })
    await qi.changeColumn('push_subscription', 'auth',     { type: dt.STRING(100), allowNull: false })
  },
}
