import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

// AES-256-GCM for uploaded documents at rest. Key comes from VITALIS_KEY (64 hex chars) or a local key file.
let _key: Buffer | undefined;
function key() {
  if (_key) return _key;
  if (process.env.VITALIS_KEY) {
    _key = Buffer.from(process.env.VITALIS_KEY, "hex");
  } else {
    const file = path.join(DATA_DIR, ".key");
    if (!fs.existsSync(file)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    _key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  }
  if (_key.length !== 32) throw new Error("VITALIS_KEY must be 32 bytes (64 hex chars)");
  return _key;
}

/** Layout: 12-byte IV | 16-byte auth tag | ciphertext */
export function encrypt(plain: Buffer) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decrypt(blob: Buffer) {
  const d = crypto.createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}
