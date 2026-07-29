const winston = require('winston');
function errorMiddleware(error, req, res, next) {
    let { status = 500, message, data } = error;

    console.log(`[Error] ${error}`);
    winston.error(error.message, error);
    console.log(error.message);
    // If status code is 500 - change the message to Intrnal server error
    if(message === 'excel_file'){
        message = req.mf('Only excel files are allowed');
    }else if(message == 'Validation error'){
        errors = [];
        error.errors.forEach(element => {
            element.message = req.mf(element.message);
            errors.push({
                msg: element.message,
                param: element.path,
                location: "body",
            })
        });
        status = 400;
        data = {errors: errors};
        
    }else {
        try {
            message = req.mf(error.message);
        } catch (e) {
            message = error.message; 
        }
    }
    // else
    //     message = status === 500 || !message ? 'Internal server error' : message;
    if(status === 500){
        message = req.originalUrl + ' ' + /*JSON.stringify(req.body)*/ + ' ' + message; 
    }

    error = {
        type: 'error',
        status,
        message,
        ...(data) && data
    }
   
    res.status(status).send(error);
}

module.exports = errorMiddleware;
/*
{
    type: 'error',
    status: 404,
    message: 'Not Found'
    data: {...} // optional
}
*/