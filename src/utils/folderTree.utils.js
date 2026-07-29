const _ = require('lodash');

let folderTree = (list, parent_id, listx = []) => {
    let elements = _.filter(list, value => value.parent_id === parent_id);

    elements.forEach(element => {
        if (element.is_folder){
            element.children = folderTree(list, element.id);
        }else{
            element.children = null;
        }
        listx.push(element)
    })

    return listx;
}

module.exports = folderTree;