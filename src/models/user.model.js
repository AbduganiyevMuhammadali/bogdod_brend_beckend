const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');
class UserModel extends Model {
    toJSON () {//password ni ko'rsatmaslik uchun
    let values = Object.assign({}, this.get());
        delete values.password;
        return values;
    }
}

UserModel.init({
    id: { 
        type: DataTypes.INTEGER, 
        primaryKey: true, 
        autoIncrement: true, 
        allowNull: false
    },
    username : {
        type: DataTypes.STRING(25),
        allowNull: false,
    },
    password : {
        type: DataTypes.STRING(60),
        allowNull: false,
    },
    fullname : {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    role : {
        type: DataTypes.ENUM('Admin', 'User', 'Programmer'),
        defaultValue: 'Admin'
    },
    email: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    warehouse: {
        type: DataTypes.STRING(100),
        allowNull: true,
    },
    permissions: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const raw = this.getDataValue('permissions');
            try { return raw ? JSON.parse(raw) : null; } catch { return null; }
        },
        set(val) {
            this.setDataValue('permissions', val ? JSON.stringify(val) : null);
        },
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    token: {
        type: DataTypes.VIRTUAL,
    },
}, {
  sequelize,
  modelName: 'UserModel',
  tableName: 'user',
  timestamps: true,
  paranoid: true,
});

module.exports = UserModel;