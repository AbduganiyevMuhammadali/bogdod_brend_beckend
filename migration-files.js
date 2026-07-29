const fs = require('fs').promises;
const path = require('path');

async function walk(dir) {
    let files = await fs.readdir(dir);
    files = await Promise.all(files.map(async file => {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) return walk(filePath);
        else if(stats.isFile()) return filePath;
    }));

    return files.reduce((all, folderContents) => all.concat(folderContents), []);
}
let migrations = async function(){
    let normalizedPath = require("path").join(__dirname, "/migrations/");
    console.log(migrations);
    let files = await walk(normalizedPath);
    let m = [];
    for(let i = 0; i < files.length; i++){
        m.push({
            name: files[i].replace(/^.*[\\\/]/, ''),
            // async up({ context }) { /* ... */ },
            // async down({ context }) { /* ... */ }
        })
        // require(files[i]);
        //console.log(`require('../../migrations/${files[i].replace(/^.*[\\\/]/, '')}');`);
    }
    console.log(m);
}

migrations();