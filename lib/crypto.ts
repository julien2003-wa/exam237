import crypto from 'node:crypto';

function masterKey() {
  const secret = String(process.env.CHAT_MASTER_KEY || '');
  if (secret.length < 32) throw new Error('CHAT_MASTER_KEY doit contenir au moins 32 caractères.');
  return crypto.createHash('sha256').update(secret).digest();
}

function roomKey(roomId: string) {
  return crypto.createHmac('sha256', masterKey()).update(`exam237:${roomId}`).digest();
}

export function encryptMessage(roomId: string, plaintext: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', roomKey(roomId), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: authTag.toString('base64url')
  };
}

export function decryptMessage(roomId: string, ciphertext: string, iv: string, authTag: string) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', roomKey(roomId), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}
