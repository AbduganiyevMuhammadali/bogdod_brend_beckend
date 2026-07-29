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