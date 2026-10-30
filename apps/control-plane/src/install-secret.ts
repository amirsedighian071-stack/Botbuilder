import { randomToken } from '@botforge/core';

/**
 * Prints a random secret for the installer wizard.
 * Usage: node --import tsx apps/control-plane/src/install-secret.ts [bytes]
 */
const size = Number(process.argv[2] ?? 32);
const bytes = Number.isFinite(size) ? Math.min(Math.max(Math.trunc(size), 16), 64) : 32;
process.stdout.write(`${randomToken(bytes, 'hex')}\n`);
