const { validationResult } = require('express-validator');
const HttpException = require('../utils/HttpException.utils');

class BaseController{
    checkValidation = (req) => {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            throw new HttpException(400, req.mf('Validation faild'), errors);
        }
    }
} 


module.exports = BaseController;