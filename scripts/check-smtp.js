require('dotenv').config({ override: true });

const nodemailer = require('nodemailer');

const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
const config = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass
    },
    tls: {
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
    }
};

console.log('SMTP config check');
console.log(`host=${config.host}`);
console.log(`port=${config.port}`);
console.log(`secure=${config.secure}`);
console.log(`user=${config.auth.user}`);
console.log(`pass_length=${pass.length}`);

nodemailer.createTransport(config).verify()
    .then(() => {
        console.log('SMTP login OK');
    })
    .catch((error) => {
        console.log('SMTP login failed');
        console.log(`code=${error.code || ''}`);
        console.log(`responseCode=${error.responseCode || ''}`);
        console.log(`message=${error.message}`);
        process.exitCode = 1;
    });
