const {extractFromFiles} = require('i18n-extract');
const glob = require("glob");

var getDirectories = function (src, callback) {
  glob(src + '/**/*.js', callback);
};

getDirectories('src', function (err, res) {
  if (err) {
    console.log('Error', err);
   
  } else {
    // console.log(res);
    const keys = extractFromFiles(res, {
        marker: 'req.mf',
      });
    // console.log(keys);
    const array = [];
    for(let i = 0; i < keys.length; i++){
      // console.log(keys[i].key);
      array.push(keys[i].key);
    }
    let unique = [...new Set(array)];
    // console.log(unique);
    // console.log(unique.length);
    for(let i = 0; i < unique.length; i++){
      console.log(`"${unique[i]}": ""`);
    }
  }
});

