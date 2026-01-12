#!/usr/bin/env node
/**
 * Simple SIP REGISTER test - no dependencies
 * Tests SIP registration over UDP to verify Asterisk connectivity
 *
 * Usage: node sip-register-test.js [options]
 *   --host     Asterisk server hostname/IP (default: localhost)
 *   --port     SIP port (default: 5060)
 *   --user     SIP username (default: 1001)
 *   --pass     SIP password (default: empty)
 *   --domain   SIP domain (default: same as host)
 */

const dgram = require('dgram');
const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith('--')) {
        acc[arg.slice(2)] = arr[i + 1] || true;
    }
    return acc;
}, {});

const config = {
    host: args.host || 'localhost',
    port: parseInt(args.port) || 5060,
    username: args.user || '1001',
    password: args.pass || '',
    domain: args.domain || args.host || 'localhost'
};

const client = dgram.createSocket('udp4');
let localPort = null;
let callId = `${Date.now()}@sip-test`;
let cseq = 1;
let branch = `z9hG4bK-${crypto.randomBytes(8).toString('hex')}`;
let fromTag = crypto.randomBytes(6).toString('hex');

console.log('\n🔌 SIP REGISTER Test (UDP)\n');
console.log(`   Server:   ${config.host}:${config.port}`);
console.log(`   Username: ${config.username}`);
console.log(`   Domain:   ${config.domain}`);
console.log('');

function buildRegisterRequest(authHeader = null) {
    const lines = [
        `REGISTER sip:${config.domain} SIP/2.0`,
        `Via: SIP/2.0/UDP ${getLocalIP()}:${localPort};branch=${branch};rport`,
        `From: <sip:${config.username}@${config.domain}>;tag=${fromTag}`,
        `To: <sip:${config.username}@${config.domain}>`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq} REGISTER`,
        `Contact: <sip:${config.username}@${getLocalIP()}:${localPort}>`,
        `Max-Forwards: 70`,
        `User-Agent: SIP-Test/1.0`,
        `Expires: 60`,
        `Content-Length: 0`
    ];

    if (authHeader) {
        lines.splice(7, 0, authHeader);
    }

    return lines.join('\r\n') + '\r\n\r\n';
}

function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

function parseResponse(data) {
    const lines = data.toString().split('\r\n');
    const statusLine = lines[0];
    const match = statusLine.match(/SIP\/2\.0 (\d+) (.+)/);

    const headers = {};
    for (let i = 1; i < lines.length; i++) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx > 0) {
            const key = lines[i].slice(0, colonIdx).toLowerCase();
            const value = lines[i].slice(colonIdx + 1).trim();
            headers[key] = value;
        }
    }

    return {
        statusCode: match ? parseInt(match[1]) : 0,
        statusText: match ? match[2] : 'Unknown',
        headers
    };
}

function computeDigestResponse(wwwAuth, method, uri) {
    // Parse WWW-Authenticate header
    const authParams = {};
    const regex = /(\w+)=(?:"([^"]+)"|([^,\s]+))/g;
    let match;
    while ((match = regex.exec(wwwAuth)) !== null) {
        authParams[match[1]] = match[2] || match[3];
    }

    const realm = authParams.realm || config.domain;
    const nonce = authParams.nonce || '';
    const algorithm = authParams.algorithm || 'MD5';

    // Calculate digest
    const ha1 = crypto.createHash('md5')
        .update(`${config.username}:${realm}:${config.password}`)
        .digest('hex');

    const ha2 = crypto.createHash('md5')
        .update(`${method}:${uri}`)
        .digest('hex');

    const response = crypto.createHash('md5')
        .update(`${ha1}:${nonce}:${ha2}`)
        .digest('hex');

    return `Authorization: Digest username="${config.username}", realm="${realm}", ` +
           `nonce="${nonce}", uri="${uri}", response="${response}", algorithm=${algorithm}`;
}

let timeout = null;

client.on('message', (msg, rinfo) => {
    clearTimeout(timeout);
    const response = parseResponse(msg);

    console.log(`← Received: ${response.statusCode} ${response.statusText}`);

    if (response.statusCode === 401 || response.statusCode === 407) {
        // Authentication required
        const wwwAuth = response.headers['www-authenticate'] || response.headers['proxy-authenticate'];
        if (wwwAuth && config.password) {
            console.log('→ Authenticating...');
            cseq++;
            branch = `z9hG4bK-${crypto.randomBytes(8).toString('hex')}`;
            const authHeader = computeDigestResponse(wwwAuth, 'REGISTER', `sip:${config.domain}`);
            const authRequest = buildRegisterRequest(authHeader);

            client.send(authRequest, config.port, config.host, (err) => {
                if (err) {
                    console.error('❌ Failed to send auth request:', err.message);
                    process.exit(1);
                }
                timeout = setTimeout(() => {
                    console.error('❌ Timeout waiting for auth response');
                    process.exit(1);
                }, 5000);
            });
        } else {
            console.error('❌ Authentication required but no password provided');
            console.log('   Use --pass <password> to provide credentials');
            process.exit(1);
        }
    } else if (response.statusCode === 200) {
        console.log('\n✅ SUCCESS - Registered with Asterisk!');
        if (response.headers['contact']) {
            console.log(`   Contact: ${response.headers['contact']}`);
        }
        if (response.headers['expires']) {
            console.log(`   Expires: ${response.headers['expires']}s`);
        }
        client.close();
        process.exit(0);
    } else if (response.statusCode >= 400) {
        console.error(`\n❌ FAILED - ${response.statusCode} ${response.statusText}`);
        client.close();
        process.exit(1);
    }
});

client.on('error', (err) => {
    console.error('❌ Socket error:', err.message);
    process.exit(1);
});

client.on('listening', () => {
    const addr = client.address();
    localPort = addr.port;

    console.log(`→ Sending REGISTER to ${config.host}:${config.port}...`);

    const request = buildRegisterRequest();
    client.send(request, config.port, config.host, (err) => {
        if (err) {
            console.error('❌ Failed to send:', err.message);
            process.exit(1);
        }

        timeout = setTimeout(() => {
            console.error('❌ Timeout - no response from server');
            console.log('   Check that Asterisk is running and accessible');
            process.exit(1);
        }, 5000);
    });
});

// Bind to random port
client.bind();
