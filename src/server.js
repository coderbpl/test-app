import { createApp } from './app.js';
import { env } from './config/env.js';
import { seed } from './db/seed.js';
import { startSlaSweep } from './jobs/slaSweep.js';
import { checkHealth } from './modules/grievances/grievance.ai.service.js';

/**
 * Boots the grievance system: applies the schema, seeds base data, starts the SLA sweep, and
 * listens. Everything is self-contained — no external database or cloud service required.
 */
async function bootstrap() {
    // Schema + seed (idempotent).
    seed();

    const app = createApp();
    startSlaSweep();

    app.listen(env.port, () => {
        /* eslint-disable no-console */
        console.log('');
        console.log('  🏥  Grievance Redressal System');
        console.log(`  →  API + UI:   http://localhost:${env.port}`);
        console.log(`  →  Citizen:    http://localhost:${env.port}/`);
        console.log(`  →  Officer:    http://localhost:${env.port}/officer.html`);
        console.log(`  →  Admin login: ${env.admin.email} / (ADMIN_PASSWORD)`);
        console.log('');
        /* eslint-enable no-console */
    });

    // Non-blocking AI reachability check for the startup log.
    checkHealth().then((ai) => {
        // eslint-disable-next-line no-console
        console.log(ai.up ? `  🤖  Ollama up (model: ${ai.model})` : `  ⚠️   Ollama not reachable (${ai.error}). Grievances still work; AI enrichment is skipped.`);
    });
}

bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal startup error:', err);
    process.exit(1);
});
