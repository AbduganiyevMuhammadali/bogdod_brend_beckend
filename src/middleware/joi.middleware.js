const middleware = (schema, property) => { 
  return (req, res, next) => { 
    const options = {
      abortEarly: false, // include all errors
      allowUnknown: true, // ignore unknown props
      stripUnknown: true // remove unknown props
    };
    const { error, value } = schema.validate(req.body, options); 
    
    if(error){ 
      const { details } = error; 
      const message = details.map(i => i.message).join(',');
      console.log(`Validation error: ${ message }`);
      next(error);
    }else{
      // So'rov tanasi logga chiqarilmaydi: login/parol va mijoz ma'lumotlari
      // pm2 loglarida ochiq matnda qolib ketardi.
      req.body = value;
      next();
    }
  } 
} 

module.exports = middleware;