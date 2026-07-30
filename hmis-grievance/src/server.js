import { createApp } from './app.js';
import { env } from './config/env.js';
import { seed } from './db/seed.js';
import { startSlaSweep } from './jobs/slaSweep.js';

function bootstrap() {
    seed();
    const app = createApp();
    startSlaSweep();
    app.listen(env.port, () => {
        /* eslint-disable no-console */
        console.log('');
        console.log('  🏥  MP HMIS — Grievance, Feedback & Ticketing');
        console.log(`  →  Public (patient): http://localhost:${env.port}/`);
        console.log(`  →  Staff console:    http://localhost:${env.port}/console.html`);
        console.log(`  →  Admin: ${env.admin.email} / (ADMIN_PASSWORD)  · staff: *@mphmis.local / staff123`);
        console.log('');
        /* eslint-enable no-console */
    });
}
bootstrap();
