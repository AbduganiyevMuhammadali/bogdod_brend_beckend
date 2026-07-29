const dotenv = require('dotenv');
dotenv.config();
module.exports = {
    port: process.env.PORT,
    host: process.env.HOST,
    db_port: process.env.DB_PORT,
    db_user: process.env.DB_USER,
    db_pass: process.env.DB_PASS,
    db_name: process.env.DB_DATABASE,
    secret_jwt: process.env.SECRET_JWT,
    node_env: process.env.NODE_ENV,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@sellz.uz',
}