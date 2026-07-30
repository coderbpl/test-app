import cron from 'node-cron';
import { env } from '../config/env.js';
import { escalateOverdue } from '../modules/grievances/grievance.repository.js';

/**
 * Runs one SLA sweep: escalates every overdue, still-open grievance one tier up the ladder.
 *
 * @returns {Array<{id:number, fromTier:string, toTier:string}>} The escalated grievances.
 */
export function runSweep() {
    const escalated = escalateOverdue();
    if (escalated.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[sla] Escalated ${escalated.length} overdue grievance(s).`);
    }
    return escalated;
}

/**
 * Schedules the recurring SLA sweep via cron. Returns the task handle.
 */
export function startSlaSweep() {
    if (!cron.validate(env.slaSweepCron)) {
        // eslint-disable-next-line no-console
        console.warn(`[sla] Invalid SLA_SWEEP_CRON "${env.slaSweepCron}" — SLA auto-escalation is OFF.`);
        return null;
    }
    const task = cron.schedule(env.slaSweepCron, runSweep);
    // eslint-disable-next-line no-console
    console.log(`[sla] Auto-escalation scheduled: "${env.slaSweepCron}"`);
    return task;
}

// Allow `npm run sla:sweep` (one-off) to run a single sweep and exit.
if (import.meta.url === `file://${process.argv[1]}`) {
    const { seed } = await import('../db/seed.js');
    seed();
    const escalated = runSweep();
    // eslint-disable-next-line no-console
    console.log(`[sla] One-off sweep done. ${escalated.length} escalated.`);
    process.exit(0);
}
