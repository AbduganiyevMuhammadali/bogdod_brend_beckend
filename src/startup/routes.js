const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require('cookie-parser')
const i18n = require('./i18n.config')
const errorMiddleware = require('../middleware/error.middleware');
require('../models/associations')
const userRouter    = require('../routes/user.route');
const productRouter  = require('../routes/product.route');
const purchaseRouter = require('../routes/purchase.route');
const saleRouter     = require('../routes/sale.route');
const clientRouter   = require('../routes/client.route');
const reportRouter    = require('../routes/report.route');
const supplierRouter  = require('../routes/supplier.route');
const notificationRouter = require('../routes/notification.route');
const inventoryRouter    = require('../routes/inventory.route');
const backupRouter       = require('../routes/backup.route');
const snapshotRouter     = require('../routes/snapshot.route');
const HttpException = require('../utils/HttpException.utils');

module.exports = async function(app){
     // parse requests of content-type: application/json
        // parses incoming requests with JSON payloads
        app.use(express.json());
        // enabling cors for all requests by using cors middleware
        app.use(cors());
        // Enable pre-flight
        app.options("*", cors());
        app.use(express.static(path.join(__dirname, '../../dist')));
        app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
        // i18n.setLocale('uz');
        app.use(cookieParser());
        app.use(i18n.init)

        app.use('/api/v1/users',     userRouter);
        app.use('/api/v1/products',  productRouter);
        app.use('/api/v1/purchases', purchaseRouter);
        app.use('/api/v1/inventories', inventoryRouter);
        app.use('/api/v1/sales',    saleRouter);
        app.use('/api/v1/clients',  clientRouter);
        app.use('/api/v1/reports',    reportRouter);
        app.use('/api/v1/suppliers',  supplierRouter);
        app.use('/api/v1/notifications', notificationRouter);
        app.use('/api/v1/backup',        backupRouter);
        app.use('/api/v1/snapshots',     snapshotRouter);
            
        // 404 error
        app.all('*', (req, res, next) => {
            const err = new HttpException(404, req.mf('Endpoint not found'));
            next(err);
        });

        app.use(errorMiddleware);
}