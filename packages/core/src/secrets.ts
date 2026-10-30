import { decryptSecret, encryptSecret, maskToken, randomToken, sha256 } from './crypto';

export interface SecretsManagerOptions {
  masterKey: string;
}

export interface StoredSecret {
  cipher: string;
  hint: string;
}

export class SecretsManager {
  private readonly masterKey: string;

  constructor(options: SecretsManagerOptions) {
    if (!options.masterKey || options.masterKey.length < 16) {
      throw new Error('SECRET_MASTER_KEY must be at least 16 characters');
    }
    this.masterKey = options.masterKey;
  }

  seal(plaintext: string): StoredSecret {
    const trimmed = plaintext.trim();
    return {
      cipher: encryptSecret(trimmed, this.masterKey),
      hint: maskToken(trimmed),
    };
  }

  open(cipher: string): string {
    return decryptSecret(cipher, this.masterKey);
  }

  rotate(cipher: string, nextMasterKey: string): StoredSecret {
    const plaintext = decryptSecret(cipher, this.masterKey);
    return {
      cipher: encryptSecret(plaintext, nextMasterKey),
      hint: maskToken(plaintext),
    };
  }
}

export function createWebhookSecret(): string {
  return randomToken(24);
}

export function webhookPathSecret(secret: string): string {
  return sha256(`webhook:${secret}`).slice(0, 32);
}
