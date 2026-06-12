#!/usr/bin/env node
/**
 * One-time helper to generate DASHBOARD_PASSWORD_HASH.
 *
 * Usage:
 *   node scripts/generate-password-hash.mjs "your-very-strong-password"
 *
 * Then set the printed value as DASHBOARD_PASSWORD_HASH in your environment.
 * You can still keep DASHBOARD_PASSWORD for reports/cron basic auth if desired.
 */
import crypto from "crypto";

const plain = process.argv[2];
if (!plain) {
  console.error("Usage: node scripts/generate-password-hash.mjs \"your-strong-password-here\"");
  process.exit(1);
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const salt = crypto.randomBytes(16);
crypto.scrypt(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const hash = `${salt.toString("hex")}:${derived.toString("hex")}`;
  console.log("Copy this into your environment (never commit the plaintext):");
  console.log(`DASHBOARD_PASSWORD_HASH=${hash}`);
  console.log("\nYou may keep DASHBOARD_PASSWORD (or REPORTS_BASIC_TOKEN) for the /api/reports/run Basic auth if you use it for cron.");
});