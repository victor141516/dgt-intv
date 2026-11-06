import { X509Certificate, createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type SigningCredentials = {
  certificate: X509Certificate;
  privateKey: KeyObject;
};

const PRIVATE_KEY_BLOCK = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]+?-----END \1-----/;
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * Reads a PEM file holding the signing certificate and its private key, as written by
 * `openssl pkcs12 -in cert.p12 -out cert.pem`. When the file also carries the CA chain,
 * the certificate that matches the private key is the one used to sign.
 */
export function loadCredentials(path: string, passphrase?: string): SigningCredentials {
  const pem = readFileSync(path, 'utf8');

  const keyBlock = pem.match(PRIVATE_KEY_BLOCK);
  if (!keyBlock) throw new Error(`${path} holds no PEM private key`);
  const privateKey = createPrivateKey({ key: keyBlock[0], format: 'pem', passphrase });

  const certificate = [...pem.matchAll(CERTIFICATE_BLOCK)]
    .map((block) => new X509Certificate(block[0]))
    .find((candidate) => candidate.checkPrivateKey(privateKey));
  if (!certificate) throw new Error(`${path} holds no certificate matching its private key`);

  return { certificate, privateKey };
}
