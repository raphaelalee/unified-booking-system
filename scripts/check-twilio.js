require('dotenv').config({ override: true });

function normalizePhone(value) {
    const digits = String(value || '').replace(/[^\d]/g, '');

    if (!digits) return '';
    if (digits.startsWith('65') && digits.length === 10) return `+${digits}`;
    if (/^[689]\d{7}$/.test(digits)) return `+65${digits}`;
    return String(value || '').startsWith('+') ? String(value) : `+${digits}`;
}

function whatsappAddress(value) {
    const raw = String(value || '').trim();
    if (raw.startsWith('whatsapp:')) return raw;
    const phone = normalizePhone(raw);
    return phone ? `whatsapp:${phone}` : '';
}

async function main() {
    const mode = String(process.argv[2] || 'sms').toLowerCase();
    const recipient = String(process.argv[3] || '').trim();
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = mode === 'whatsapp'
        ? whatsappAddress(process.env.TWILIO_WHATSAPP_FROM)
        : process.env.TWILIO_PHONE_NUMBER;
    const to = mode === 'whatsapp' ? whatsappAddress(recipient) : normalizePhone(recipient);

    console.log('Twilio config check');
    console.log(`mode=${mode}`);
    console.log(`account_sid_present=${Boolean(accountSid)}`);
    console.log(`auth_token_present=${Boolean(authToken)}`);
    console.log(`from_present=${Boolean(from)}`);
    console.log(`to_present=${Boolean(to)}`);

    if (!['sms', 'whatsapp'].includes(mode)) {
        throw new Error('Usage: node scripts/check-twilio.js sms|whatsapp <recipient-phone>');
    }

    if (!accountSid || !authToken || !from || !to) {
        throw new Error('Twilio config is incomplete. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and the sender env var.');
    }

    const params = new URLSearchParams({
        To: to,
        From: from,
        Body: `Vaniday Twilio ${mode} test`
    });
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });
    const data = await response.json().catch(() => ({}));

    console.log(`status=${response.status}`);
    console.log(`twilio_code=${data.code || ''}`);
    console.log(`message=${data.message || data.status || 'OK'}`);
    console.log(`sid=${data.sid || ''}`);

    if (!response.ok) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
