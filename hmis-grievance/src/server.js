import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { seed } from './db/seed.js';

function bootstrap() {
    seed();
    const app = createApp();

    const { keyFile, certFile } = env.ssl;
    const useHttps = keyFile && certFile && fs.existsSync(keyFile) && fs.existsSync(certFile);
    const server = useHttps
        ? https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app)
        : http.createServer(app);

    server.listen(env.port, () => {
        const proto = useHttps ? 'https' : 'http';
        /* eslint-disable no-console */
        console.log('');
        console.log('  🏥  MP HMIS — Grievance (ticket-based), Feedback & Support');
        console.log(`  →  Public site:   ${proto}://localhost:${env.port}/`);
        console.log(`  →  Staff console: ${proto}://localhost:${env.port}/console.html`);
        console.log(`  →  Admin: ${env.admin.email} / (ADMIN_PASSWORD)  · staff: *@mphmis.local / staff123`);
        if (useHttps) console.log('  🔒  Serving over HTTPS (TLS) — PII is encrypted in transit.');
        else console.log('  ⚠️   HTTP only. Set SSL_KEY_FILE + SSL_CERT_FILE for TLS in transit (see README).');
        console.log('');
        /* eslint-enable no-console */
    });
}
bootstrap();
