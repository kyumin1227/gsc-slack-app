import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class CryptoUtil {
  private static getKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;

    if (!secret) {
      throw new Error(
        'ENCRYPTION_SECRET is not configured. ' +
          'Set ENCRYPTION_SECRET environment variable.',
      );
    }

    // 32바이트 키 생성 (AES-256)
    return crypto.scryptSync(secret, 'salt', 32);
  }

  // 암호화
  static encrypt(plainText: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // iv + authTag + encrypted 를 합쳐서 반환
    return iv.toString('hex') + authTag.toString('hex') + encrypted;
  }

  // 복호화
  static decrypt(encryptedText: string): string {
    const key = this.getKey();

    // iv, authTag, encrypted 분리
    const iv = Buffer.from(encryptedText.slice(0, IV_LENGTH * 2), 'hex');
    const authTag = Buffer.from(
      encryptedText.slice(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2),
      'hex',
    );
    const encrypted = encryptedText.slice(
      IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2,
    );

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
