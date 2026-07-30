import { createApp } from './app.js';
import { env } from './config/env.js';
import { seed } from './db/seed.js';
import { startEmailPoll } from './jobs/emailPoll.js';
import { checkHealth } from './modules/tickets/ticket.ai.service.js';

async function bootstrap() {
    seed();
    const app = createApp();
    startEmailPoll();

    app.listen(env.port, () => {
        /* eslint-disable no-console */
        console.log('');
        console.log('  🎫  Smart Helpdesk');
        console.log(`  →  Submit ticket: http://localhost:${env.port}/`);
        console.log(`  →  Agent console: http://localhost:${env.port}/agent.html`);
        console.log(`  →  Admin login:   ${env.admin.email} / (ADMIN_PASSWORD)   · agents: *@helpdesk.local / agent123`);
        console.log('');
        /* eslint-enable no-console */
    });

    checkHealth().then((ai) => {
        // eslint-disable-next-line no-console
        console.log(ai.up
            ? `  🤖  Groq ready (model: ${ai.model})`
            : `  ⚠️   Groq off (${ai.error}). Tickets + similarity routing still work; AI classify/draft skipped.`);
    });
}

bootstrap().catch((err) => {
    console.error('Fatal startup error:', err); // eslint-disable-line no-console
    process.exit(1);
});
