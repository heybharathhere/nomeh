/* Passphrase encryption for backup files, using WebCrypto only.
 *
 * WHAT THIS PROTECTS AGAINST
 *   Someone who obtains your exported backup file — from cloud storage, a
 *   shared drive, a lost USB stick — cannot read it without the passphrase.
 *
 * WHAT IT DOES NOT PROTECT AGAINST
 *   Anything happening on this device. The live database is not encrypted; it
 *   cannot be, because the app has to read it. Someone with your unlocked phone
 *   has your data. Browser-side encryption is not equivalent to a hardened
 *   server, and the UI says so rather than implying otherwise.
 *
 * ON PASSKEYS
 *   A passkey can gate entry to the app, but deriving an encryption key from one
 *   needs the WebAuthn PRF extension, which is not widely enough supported to
 *   build on. So the passphrase is the real mechanism and a passkey is offered
 *   only as a convenience unlock on top of it — see capabilities.js.
 *
 * The output format is self-describing: the header carries the KDF parameters,
 * so a file encrypted today still opens after these defaults change.
 */

import { SECURITY, APP } from '../config/app.config.js';

const MAGIC = 'NOMEH-ENC';
const FORMAT = 1;

export function cryptoAvailable() {
  return typeof crypto !== 'undefined' &&
         !!crypto.subtle &&
         typeof crypto.getRandomValues === 'function';
}

/* Base64 via binary string. Chunked because a naive spread of a multi-megabyte
   array blows the argument limit on some engines. */
function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations, hash) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash },
    material,
    { name: SECURITY.cipher, length: SECURITY.keyBits },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* Honest, non-scolding passphrase feedback. It reports what a passphrase is and
   is not, and never refuses on style grounds — length is the only hard rule,
   because length is the only thing that reliably matters. */
export function assessPassphrase(passphrase) {
  const s = String(passphrase ?? '');
  if (s.length < SECURITY.minPassphrase) {
    return {
      ok: false,
      strength: 'too short',
      message: `At least ${SECURITY.minPassphrase} characters. A few unrelated words is ideal — ` +
               'length beats punctuation.',
    };
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(s)).length;
  const words = s.trim().split(/\s+/).length;
  const score = s.length + classes * 4 + (words >= 3 ? 12 : 0);
  const strength = score >= 42 ? 'strong' : score >= 28 ? 'reasonable' : 'weak';
  return {
    ok: true,
    strength,
    message: strength === 'weak'
      ? 'This will work, but a longer phrase would be much harder to guess.'
      : 'If you lose this passphrase the backup cannot be recovered. There is no reset.',
  };
}

/* Encrypts a JSON-serialisable object. Returns a string safe to write to a file. */
export async function encryptJson(data, passphrase) {
  if (!cryptoAvailable()) throw new Error('WebCrypto is not available in this browser.');
  const check = assessPassphrase(passphrase);
  if (!check.ok) throw new Error(check.message);

  const salt = crypto.getRandomValues(new Uint8Array(SECURITY.saltBytes));
  const iv = crypto.getRandomValues(new Uint8Array(SECURITY.ivBytes));
  const iterations = SECURITY.kdfIterations;
  const hash = SECURITY.kdfHash;

  const key = await deriveKey(passphrase, salt, iterations, hash);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: SECURITY.cipher, iv }, key, plaintext);

  /* The header is deliberately plaintext. It contains no secret, and without it
     a future version could not work out how to derive the key. */
  return JSON.stringify({
    magic: MAGIC,
    format: FORMAT,
    app: APP.name,
    appVersion: APP.version,
    createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash, iterations, salt: toBase64(salt) },
    cipher: { name: SECURITY.cipher, iv: toBase64(iv), bits: SECURITY.keyBits },
    payload: toBase64(new Uint8Array(cipher)),
  }, null, 2);
}

export function isEncrypted(text) {
  if (typeof text !== 'string') return false;
  /* Cheap check before paying to parse a large file. */
  if (!text.includes(MAGIC)) return false;
  try { return JSON.parse(text)?.magic === MAGIC; } catch { return false; }
}

/* Decrypts. Distinguishes a wrong passphrase from a corrupt file, because those
   two problems have completely different remedies. */
export async function decryptJson(text, passphrase) {
  if (!cryptoAvailable()) throw new Error('WebCrypto is not available in this browser.');

  let envelope;
  try { envelope = JSON.parse(text); }
  catch { throw new Error('This file is not readable as an encrypted NoMeh! backup.'); }

  if (envelope?.magic !== MAGIC) {
    throw new Error('This file is not an encrypted NoMeh! backup.');
  }
  if (envelope.format > FORMAT) {
    throw new Error(`This backup was written by a newer version of ${APP.name} (format ${envelope.format}). Update the app first.`);
  }
  const { kdf, cipher, payload } = envelope;
  if (!kdf?.salt || !cipher?.iv || !payload) {
    throw new Error('The backup header is incomplete, so the file cannot be decrypted.');
  }

  const key = await deriveKey(
    passphrase,
    fromBase64(kdf.salt),
    kdf.iterations ?? SECURITY.kdfIterations,
    kdf.hash ?? SECURITY.kdfHash,
  );

  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: cipher.name ?? SECURITY.cipher, iv: fromBase64(cipher.iv) },
      key,
      fromBase64(payload),
    );
  } catch {
    /* AES-GCM authentication failed. Overwhelmingly the passphrase; possibly a
       truncated file. Both are worth naming. */
    throw new Error('Could not decrypt. The passphrase is wrong, or the file is damaged.');
  }

  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Decrypted successfully but the contents are not valid backup data.');
  }
}

/* Rough timing for the UI, so a three-second pause on a slow phone reads as
   "working" rather than "frozen". */
export async function benchmarkKdf() {
  if (!cryptoAvailable()) return null;
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  await deriveKey('benchmark-only', crypto.getRandomValues(new Uint8Array(16)),
                  SECURITY.kdfIterations, SECURITY.kdfHash);
  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  return Math.round(t1 - t0);
}
