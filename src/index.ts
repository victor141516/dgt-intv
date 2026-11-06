import express from 'express';
import { config } from './config.ts';
import { loadCredentials } from './credentials.ts';
import { buildSignedRequest, parseResponse } from './intv.ts';

const credentials = loadCredentials(config.certPath, config.certPassphrase);
const PLATE = /^[A-Z0-9]{2,12}$/;

const app = express();

app.get('/vehicles/:plate', async (req, res) => {
  const plate = req.params.plate.toUpperCase().replace(/[\s-]/g, '');
  if (!PLATE.test(plate)) {
    res.status(400).json({ error: 'invalid_plate', message: 'The plate may only contain letters and digits.' });
    return;
  }

  const started = Date.now();
  let xml: string;
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"obtenerInformeReducido"' },
      body: buildSignedRequest(config.nif, plate, credentials),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    xml = await response.text();
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    console.error(`${plate}: ${timedOut ? 'timeout' : 'network error'}`, error);
    res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? 'dgt_timeout' : 'dgt_unreachable', message: String(error) });
    return;
  }

  const parsed = parseResponse(xml);
  const elapsed = `${Date.now() - started}ms`;
  switch (parsed.kind) {
    case 'report': {
      const { report } = parsed;
      console.log(`${plate}: ${report.codigoRetorno} ${elapsed}`);
      res.status(report.codigoRetorno === 'INTV000' ? 200 : 422).json(report);
      return;
    }
    case 'fault':
      console.error(`${plate}: SOAP fault ${parsed.code} ${parsed.message} ${elapsed}`);
      res.status(502).json({ error: 'dgt_fault', code: parsed.code, message: parsed.message });
      return;
    case 'unknown':
      console.error(`${plate}: unexpected response ${elapsed}\n${xml.slice(0, 2000)}`);
      res.status(502).json({ error: 'dgt_unexpected_response' });
      return;
  }
});

app.listen(config.port, () => {
  console.log(`dgt-intv listening on :${config.port}`);
  console.log(`Certificate: ${credentials.certificate.subject.replace(/\n/g, ', ')} (expires ${credentials.certificate.validTo})`);
  console.log(`Endpoint: ${config.endpoint}`);
});
