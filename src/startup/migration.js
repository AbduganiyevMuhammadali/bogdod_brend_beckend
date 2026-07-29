// index.js
const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');
const sequelize = require('../db/db-sequelize');

const umzug = new Umzug({
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
  migrations: [
  ]
});

module.exports = async function(){
    try{
        await umzug.up();
    }catch(e){
        console.log('Xatolik', e);
    }
}