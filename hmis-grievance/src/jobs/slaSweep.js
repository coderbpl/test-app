import cron from 'node-cron';
import { env } from '../config/env.js';
import { escalateOverdue } from '../modules/grievances.module.js';

export function runSweep() {
    const escalated = escalateOverdue();
    if (escalated.length) console.log(`[sla] Escalated ${escalated.length} overdue grievance(s).`); // eslint-disable-line no-console
    return escalated;
}
export function startSlaSweep() {
    if (!cron.validate(env.slaSweepCron)) { console.warn(`[sla] Invalid cron "${env.slaSweepCron}" — SLA escalation OFF.`); return null; } // eslint-disable-line no-console
    console.log(`[sla] Auto-escalation scheduled: "${env.slaSweepCron}"`); // eslint-disable-line no-console
    return cron.schedule(env.slaSweepCron, runSweep);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { seed } = await import('../db/seed.js');
    seed();
    console.log(`[sla] One-off sweep escalated ${runSweep().length}.`); // eslint-disable-line no-console
    process.exit(0);
}
