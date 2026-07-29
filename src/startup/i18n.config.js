const { I18n } = require('i18n');
const path = require('path');
const uz = require('./locales/uz.json');
const ru = require('./locales/ru.json');
const uzk = require('./locales/uzk.json');

const i18n = new I18n({
  locales: ['uz', 'uzk', 'ru'],
  defaultLocale: 'uz',
  cookie: 'cookiename',
  directory: path.join(__dirname, 'locales'),
  register: global,
  api: {
    __: 't', // now req.__ becomes req.t
    __n: 'tn', // and req.__n can be called as req.tn
    __mf: 'mf',
  },
  staticCatalog: {
    uz,
    ru,
    uzk
  },
});

module.exports = i18n;