const HttpException = require('../utils/HttpException.utils');
const UserModel = require('../models/user.model');
const jwt = require('jsonwebtoken');
const {secret_jwt} = require('../startup/config')
const userRoles = require('../utils/userRoles.utils');

const auth = (...roles) => {
    return async function (req, res, next) {
        try {
            const authHeader = req.headers.authorization;
            const bearer = 'Bearer ';

            if (!authHeader || !authHeader.startsWith(bearer)) {
                throw new HttpException(401, req.mf('Access denied. No credentials sent!'));
            }

            const token = authHeader.replace(bearer, '');

            // Verify Token
            const decoded = jwt.verify(token, secret_jwt);
            const user = await UserModel.findOne({where:{ id: decoded.user_id }});

            if (!user) {
                throw new HttpException(401, req.mf('Authentication failed!'));
            }

            // check if the current user is the owner user
            const ownerAuthorized = req.params.id == user.id;

            // if the current user is not the owner and
            // if the user role don't have the permission to do this action.
            // the user will get this error
            if (!ownerAuthorized && roles.length && !roles.includes(user.role)) {
                throw new HttpException(401, req.mf('Unauthorized'));
            }

            // if the user has permissions
            req.currentUser = user;
            
            next();

        } catch (e) {
            e.status = 401;
            next(e);
        }
    }
}

module.exports = auth;