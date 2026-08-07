// Vaqt zonasi — boshqa hamma narsadan OLDIN belgilanishi shart, chunki
// keyin yuklanadigan modullar (Sequelize, sana hisoblari) uni o'qib oladi.
//
// Server UTC da ishlashi mumkin, do'kon esa Toshkentda. Bunda `new Date()`,
// `setHours(0,0,0,0)` va kun chegaralari UTC bo'yicha hisoblanib, hisobotlar
// bir kun oldingi sanani ko'rsatib qolardi (tunda va tongda qilingan
// savdolar avvalgi kunga tushardi). Shuning uchun zonani aniq majburlaymiz.
// SHOP_TZ berilsa o'sha ishlatiladi, aks holda Toshkent. Serverning o'z
// TZ o'zgaruvchisiga tayanmaymiz — u ko'pincha UTC bo'ladi va aynan shu
// noto'g'ri sanalarga olib kelardi.
process.env.TZ = process.env.SHOP_TZ || 'Asia/Tashkent';

const express = require("express");
const app = express();
require('./startup/logging')();
require('./startup/db')();
const {port} = require('./startup/config');
require('./startup/routes')(app);
require('./startup/migration')();
require('./startup/notificationCron')();

app.listen(port, () => console.log(`🚀 Server running on port ${port}!`))
    .on('error', (e) => {
        console.log('Error happened: ', e.message)
     });

module.exports = app;