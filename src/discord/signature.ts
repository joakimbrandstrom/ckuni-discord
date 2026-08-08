import { createPublicKey, verify } from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyDiscordSignature(args: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  rawBody: string;
}): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = args;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki'
    });

    return verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, 'hex')
    );
  } catch {
    return false;
  }
}
