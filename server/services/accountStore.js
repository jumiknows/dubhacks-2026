import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Accounts and sessions saved to one JSON file, so sign-ins and setup
 * answers survive a server restart.
 *
 *   ACCOUNTS_FILE   default server/data/accounts.json (gitignored)
 *   SESSION_SECRET  encrypts stored Google tokens; generated into
 *                   server/data/secret.key on first run when unset
 *
 * On disk, session ids are stored only as SHA-256 hashes and Google tokens
 * are AES-256-GCM encrypted. Writes go to a temp file and are renamed into
 * place, so a crash never leaves half a file.
 */

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export function hashSessionId(sid) {
  return createHash("sha256").update(sid).digest("base64url");
}

function secretKey(env, file) {
  let secret = env.SESSION_SECRET;
  if (!secret) {
    const keyFile = join(dirname(file), "secret.key");
    if (existsSync(keyFile)) secret = readFileSync(keyFile, "utf8").trim();
    else {
      secret = randomBytes(32).toString("base64url");
      mkdirSync(dirname(keyFile), { recursive: true });
      writeFileSync(keyFile, secret, { mode: 0o600 });
    }
  }
  return createHash("sha256").update(secret).digest();
}

function encrypt(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

function decrypt(key, text) {
  try {
    const [iv, tag, data] = text.split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
  } catch {
    return null; // Wrong SESSION_SECRET or a damaged entry: the user just signs in again.
  }
}

export function openAccountStore(env = process.env) {
  const file = env.ACCOUNTS_FILE || join(DATA_DIR, "accounts.json");
  const key = secretKey(env, file);
  const sessions = new Map(); // hashed sid → { accountId, profile, expiresAt }
  const accounts = new Map(); // google sub → { id, email, name, picture, tokens, profile, createdAt }

  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      for (const account of saved.accounts ?? []) {
        accounts.set(account.id, { ...account, tokens: account.tokens ? decrypt(key, account.tokens) : null });
      }
      for (const session of saved.sessions ?? []) {
        if (session.expiresAt > Date.now()) sessions.set(session.id, session);
      }
    } catch (err) {
      // Keep the unreadable file for inspection instead of overwriting it.
      const aside = `${file}.unreadable-${Date.now()}`;
      renameSync(file, aside);
      console.error(`[accounts] Could not read ${file} (${err.message}); moved it to ${aside} and started empty.`);
    }
  }

  function save() {
    const data = {
      version: 1,
      accounts: [...accounts.values()].map((account) => ({
        ...account,
        tokens: account.tokens ? encrypt(key, account.tokens) : null,
      })),
      // An in-progress Google sign-in (oauth) holds the PKCE verifier and stays in memory only.
      sessions: [...sessions.values()]
        .filter((session) => session.expiresAt > Date.now())
        .map(({ oauth, ...session }) => session),
    };
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temp, file);
    chmodSync(file, 0o600);
  }

  return { file, sessions, accounts, save };
}
