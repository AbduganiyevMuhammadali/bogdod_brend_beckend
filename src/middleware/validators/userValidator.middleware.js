const Joi = require('joi');
const Role = require('../../utils/userRoles.utils');

const extraFields = {
  email:       Joi.string().email({ tlds: { allow: false } }).allow('', null).optional(),
  warehouse:   Joi.string().max(100).allow('', null).optional(),
  permissions: Joi.object().allow(null).optional(),
  active:      Joi.boolean().optional(),
};

exports.userSchemas = {
  create: Joi.object({
    username: Joi.string().required().min(3).max(25),
    fullname: Joi.string().required().min(3).max(50),
    role: Joi.string().valid(Role.Admin, Role.User, Role.Programmer).required(),
    password: Joi.string().min(3).required().label('Password'),
    confirmPassword: Joi.any().equal(Joi.ref('password'))
        .required()
        .label('Confirm password')
        .messages({ 'any.only': '{{#label}} does not match' }),
    ...extraFields,
  }),

  update: Joi.object({
    username: Joi.string().required().min(3).max(25),
    fullname: Joi.string().required().min(3).max(50),
    role: Joi.string().valid(Role.Admin, Role.User, Role.Programmer).required(),
    password: Joi.string().min(3).label('Password').empty(''),
    confirmPassword: Joi.any().equal(Joi.ref('password')).empty('')
        .label('Confirm password')
        .messages({ 'any.only': '{{#label}} does not match' }),
    ...extraFields,
  }),

  login: Joi.object({
    username: Joi.string().empty(''),
    password: Joi.string().required(),
  }),
};
