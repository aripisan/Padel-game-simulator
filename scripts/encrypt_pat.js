/**
 * Encrypt a GitHub PAT with the host password -> blob for CONFIG.updateBlob in index.html.
 * Matches the browser's decryptBlob(): PBKDF2-SHA256 (310k iters) + AES-256-GCM,
 * blob layout: salt(16) + iv(12) + ciphertext, base64.
 *
 * Usage: node scripts/encrypt_pat.js "<github_pat>" "<host_password>"
 */
const { webcrypto } = require("crypto");
const subtle = webcrypto.subtle;
const getRandomValues = webcrypto.getRandomValues.bind(webcrypto);

async function main() {
  const [pat, password] = process.argv.slice(2);
  if (!pat || !password) {
    console.error('Usage: node scripts/encrypt_pat.js "<github_pat>" "<host_password>"');
    process.exit(1);
  }
  const salt = getRandomValues(new Uint8Array(16));
  const iv = getRandomValues(new Uint8Array(12));
  const km = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(pat)));
  const blob = Buffer.concat([Buffer.from(salt), Buffer.from(iv), Buffer.from(ct)]).toString("base64");
  console.log(blob);
}
main();
