'use strict';

require('dotenv').config();

const { startEncapsulatorApi } = require('./encapsulator-api');

process.on('uncaughtException', (err) => {
  console.error('Encapsulator uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Encapsulator unhandled rejection:', reason);
});

startEncapsulatorApi();
