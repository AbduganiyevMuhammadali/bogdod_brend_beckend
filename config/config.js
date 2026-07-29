const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  "development": {
    "username": process.env.DB_USER,
    "password": process.env.DB_PASS,
    "database": process.env.DB_DATABASE,
    "port": process.env.DB_PORT,
    "host": process.env.HOST,
    "dialect": "mysql",
  },
}
