import crypto from "crypto";

/**
 * Password hashing utilities (Node.js crypto.scrypt only).
 * These must never be imported by code that can run in the Edge runtime (middleware).
 * Only the login route handler and one-off scripts should import this.
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export async function hashDashboardPassword(plain: string): Promise<string> {
  if (!plain) throw new Error("password required");
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) return reject(err);
      resolve(`${salt.toString("hex")}:${derived.toString("hex")}`);
    });
  });
}

export async function verifyDashboardPassword(plain: string, storedHash?: string): Promise<boolean> {
  if (!plain || !storedHash) return false;
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  return new Promise((resolve) => {
    crypto.scrypt(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(expected, derived));
      } catch {
        resolve(false);
      }
    });
  });
}

/** Convenience for the generate script */
export async function __printHashForCli(plain: string) {
  const h = await hashDashboardPassword(plain);
  console.log("DASHBOARD_PASSWORD_HASH=" + h);
  return h;
}