const { Sequelize } = require('sequelize');
const config = require('../startup/config');

const sequelize = new Sequelize(
    config.db_name, 
    config.db_user, 
    config.db_pass,
    {
        host:  config.host,
        port: config.db_port,
        dialect: 'mysql',
        // Do'kon vaqt zonasi. Bu belgilanmaganda MySQL sessiyasi UTC da
        // ochilardi, Node esa mahalliy zonada ishlardi — natijada bitta
        // hujjatning `date` va `createdAt` maydonlari 5 soat farq qilib
        // yozilardi va hisobotlarda vaqt noto'g'ri ko'rinardi.
        timezone: config.timezone,
        dialectOptions:{
            decimalNumbers: true,
            multipleStatements: true,
            // O'qishda ham shu zona qo'llanadi — DATETIME matn sifatida
            // emas, to'g'ri lahza sifatida qaytadi.
            timezone: config.timezone,
        },
        logging: config.node_env !== 'production'
    }
);


module.exports = sequelize;