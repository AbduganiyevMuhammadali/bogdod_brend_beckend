const dotenv = require('dotenv');
dotenv.config();

const base = {
  "username": process.env.DB_USER,
  "password": process.env.DB_PASS,
  "database": process.env.DB_DATABASE,
  "port": process.env.DB_PORT,
  "host": process.env.HOST,
  "dialect": "mysql",
};

module.exports = {
  "development": base,
  "test": base,
  "production": base,
}
