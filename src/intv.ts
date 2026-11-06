import { createHash, sign } from 'node:crypto';
import type { SigningCredentials } from './credentials.ts';

const SOAPENV = 'http://schemas.xmlsoap.org/soap/envelope/';
const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const INF = 'http://www.trafico.es/servicios/vehiculos/comunicaciones/webservices/informeReducido';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const X509V3 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3';
const BASE64 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

const BODY_ID = 'Body-1';
const TIMESTAMP_ID = 'TS-1';
const TOKEN_ID = 'X509-1';
const VALIDITY_MS = 5 * 60_000;

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const reference = (id: string, canonical: string) =>
  `<ds:Reference URI="#${id}"><ds:Transforms><ds:Transform Algorithm="${EXC_C14N}"></ds:Transform></ds:Transforms>` +
  `<ds:DigestMethod Algorithm="${SHA1}"></ds:DigestMethod>` +
  `<ds:DigestValue>${createHash('sha1').update(canonical, 'utf8').digest('base64')}</ds:DigestValue></ds:Reference>`;

/**
 * Builds the signed obtenerInformeReducido envelope required by the DGT (WS-Security,
 * XMLDSig rsa-sha1 over Body and Timestamp, exclusive canonicalization).
 *
 * Each signed element is written already in its exclusive-c14n form (namespaces it uses
 * declared on itself, attributes ordered, explicit end tags, no whitespace), so the
 * digested string is byte-for-byte what the DGT canonicalizes on its side.
 */
export function buildSignedRequest(doi: string, plate: string, credentials: SigningCredentials, now = new Date()) {
  const body =
    `<soapenv:Body xmlns:soapenv="${SOAPENV}" xmlns:wsu="${WSU}" wsu:Id="${BODY_ID}">` +
    `<inf:obtenerInformeReducido xmlns:inf="${INF}"><solicitudInforme>` +
    `<doi>${escapeText(doi)}</doi><matricula>${escapeText(plate)}</matricula>` +
    `</solicitudInforme></inf:obtenerInformeReducido></soapenv:Body>`;

  const timestamp =
    `<wsu:Timestamp xmlns:wsu="${WSU}" wsu:Id="${TIMESTAMP_ID}">` +
    `<wsu:Created>${now.toISOString()}</wsu:Created>` +
    `<wsu:Expires>${new Date(now.getTime() + VALIDITY_MS).toISOString()}</wsu:Expires></wsu:Timestamp>`;

  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${DS}"><ds:CanonicalizationMethod Algorithm="${EXC_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA1}"></ds:SignatureMethod>` +
    reference(BODY_ID, body) +
    reference(TIMESTAMP_ID, timestamp) +
    `</ds:SignedInfo>`;
  const signatureValue = sign('sha1', Buffer.from(signedInfo, 'utf8'), credentials.privateKey).toString('base64');

  return (
    `<soapenv:Envelope xmlns:soapenv="${SOAPENV}"><soapenv:Header>` +
    `<wsse:Security xmlns:wsse="${WSSE}" xmlns:wsu="${WSU}" soapenv:mustUnderstand="1">` +
    `<wsse:BinarySecurityToken EncodingType="${BASE64}" ValueType="${X509V3}" wsu:Id="${TOKEN_ID}">` +
    credentials.certificate.raw.toString('base64') +
    `</wsse:BinarySecurityToken>` +
    timestamp +
    `<ds:Signature xmlns:ds="${DS}">${signedInfo}<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><wsse:SecurityTokenReference><wsse:Reference URI="#${TOKEN_ID}" ValueType="${X509V3}"></wsse:Reference>` +
    `</wsse:SecurityTokenReference></ds:KeyInfo></ds:Signature>` +
    `</wsse:Security></soapenv:Header>${body}</soapenv:Envelope>`
  );
}

/**
 * Fields of ResultadoInformeReducido, keyed by the DGT's own (Spanish) element names so they can be
 * looked up in the DGT manual; values are trimmed because the DGT pads some of them with spaces.
 */
export type ReducedReport = {
  codigoRetorno: string;
  descripcionRetorno: string;
  [field: string]: string | null;
};

export type IntvResponse =
  | { kind: 'report'; report: ReducedReport }
  | { kind: 'fault'; code: string; message: string }
  | { kind: 'unknown' };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeText = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]!)
    .trim();

const element = (xml: string, name: string) =>
  xml.match(new RegExp(`<((?:[\\w.-]+:)?)${name}\\b[^>]*>([\\s\\S]*?)</\\1${name}>`))?.[2];

/** Reads the SOAP response; the DGT schema is flat, so leaf elements map directly to JSON fields. */
export function parseResponse(xml: string): IntvResponse {
  const fault = element(xml, 'Fault');
  if (fault !== undefined) {
    return {
      kind: 'fault',
      code: decodeText(element(fault, 'faultcode') ?? ''),
      message: decodeText(element(fault, 'faultstring') ?? ''),
    };
  }

  const result = element(xml, 'ResultadoInformeReducido');
  if (result === undefined) return { kind: 'unknown' };

  const communication = element(result, 'resultadoComunicacion') ?? '';
  const report: ReducedReport = {
    codigoRetorno: decodeText(element(communication, 'codigoRetorno') ?? ''),
    descripcionRetorno: decodeText(element(communication, 'descripcionRetorno') ?? ''),
  };
  const fields = result.replace(/<((?:[\w.-]+:)?)resultadoComunicacion\b[\s\S]*?<\/\1resultadoComunicacion>/, '');
  for (const [, , name, value] of fields.matchAll(/<((?:[\w.-]+:)?)([\w.-]+)(?:\s[^>]*)?>([^<]*)<\/\1\2>/g)) {
    report[name!] = decodeText(value!);
  }
  for (const [, name] of fields.matchAll(/<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?\/>/g)) report[name!] = null;
  return { kind: 'report', report };
}
