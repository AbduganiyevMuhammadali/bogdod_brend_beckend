require('express-async-errors');
const winston = require('winston');

module.exports = async function(){
    // winston.add(new winston.transports.Console());
    // winston.add(new winston.transports.File({filename: 'bdm-backend.log', level: 'error'}));

    // process.on('uncaughtException', exception => {
    //   winston.error(exception.message, exception);
    // })

    winston.exceptions.handle(new winston.transports.Console(),  new winston.transports.File({filename: 'bdm-backend.log', level: 'error'}));
    //const myPromise = Promise.reject('yana boshqa kutilmagan xatolik').then('tugadi');
    process.on('unhandledRejection', exception => {
        //winston.error('unhandledRejection xatosi' + exception.message, exception);
        throw exception;
    })

    //throw new Error('Kutilmagan xato');
}