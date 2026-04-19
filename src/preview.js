'use strict';

// Hardcoded environment for local preview on Mac
process.env.API_HOST = '127.0.0.1';
process.env.API_PORT = '3000';
process.env.NODE_ENV = 'development';
process.env.MANAGEMENT_NIC = 'eno1';
process.env.MULTICAST_NIC = 'eno2';
process.env.FORWARD_MULTICAST_SUBNET = '239.100.25.0/26';
process.env.FORWARD_MULTICAST_IP = '239.100.25.29';
process.env.SRT_HOST = '127.0.0.1';
process.env.SRT_PORT = '9999';

const { start } = require('./api');

// Handle common startup errors
process.on('uncaughtException', (err) => {
    console.error('PREVIEW ERROR:', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error('Port 3000 is occupied. Attempting to kill existing process...');
    }
});

console.log('Starting Labotech Professional Preview (Mac Local)...');
start();
