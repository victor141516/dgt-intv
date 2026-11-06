import { configure, customConfigElement } from 'konfuz';
import { z } from 'zod';

export const config = configure({
  port: customConfigElement({
    type: z.coerce.number().int().positive().default(3000),
    cmdDescription: 'HTTP port',
  }),
  certPath: customConfigElement({
    type: z.string().min(1),
    cmdDescription: 'PEM file holding the signing certificate and its private key',
  }),
  certPassphrase: customConfigElement({
    type: z.string().optional(),
    secret: true,
    cmdDescription: 'Passphrase of the private key, when the PEM keeps it encrypted',
  }),
  nif: customConfigElement({
    type: z.string().min(1),
    cmdDescription: 'NIF/CIF registered with the DGT; sent as the DOI of every query',
  }),
  endpoint: customConfigElement({
    type: z.url(),
    cmdDescription: 'URL of the DGT ServicioInformesReducidoIntv web service',
  }),
  timeoutMs: customConfigElement({
    type: z.coerce.number().int().positive().default(30_000),
    cmdDescription: 'How long to wait for the DGT, in milliseconds',
  }),
});
