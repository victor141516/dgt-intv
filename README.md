# dgt-intv

A small HTTP service that looks up a Spanish vehicle by its number plate in the DGT's (Dirección
General de Tráfico) **INTV** web service and returns the result as JSON:

```sh
curl http://localhost:3000/vehicles/1234BBB
```

```json
{
  "codigoRetorno": "INTV000",
  "descripcionRetorno": "Informe generado correctamente.",
  "marca": "RENAULT",
  "modelo": "MEGANE",
  "combustible": "DIESEL",
  "fechaPrimeraMatricula": "2000-09-25T00:00:00.000+02:00",
  "estadoVerificacion": "CON_INCIDENCIAS",
  "matricula": "1234BBB",
  "bastidor": "--",
  "nive": "--",
  "numeroSerie": "--",
  "fechaSolicitud": "2026-11-06T18:15:00.764+01:00"
}
```

The DGT's API is SOAP with signed XML messages, restricted to registered IP addresses and
certificates. This service hides all of that behind one `GET` endpoint. It is written in TypeScript,
runs on [Bun](https://bun.sh) and only depends on Express,
[konfuz](https://github.com/victor141516/konfuz) and Zod: the XML signature uses Bun's built-in crypto.

> [!WARNING]
> The service has **no authentication** and signs every query with **your** certificate, which is
> your legal identity before the Spanish administration. Never expose it to the Internet: keep it on
> a private network (a VPN such as Tailscale, a Docker network, `localhost`…).

## Background: the DGT's INTV service

INTV (*Informe Telemático de Vehículos*) is how the DGT lets companies query the Spanish vehicle
register from their own systems. It offers two kinds of query
([official page](https://sede.dgt.gob.es/es/vehiculos/tramites-para-empresas/informe-telematico-de-vehiculos/index.html)):

- **Reduced report** (*informe reducido*), **free**: make, model, date of first registration, fuel,
  and a flag telling whether the register holds anything that stops the vehicle from being driven
  (expired ITV inspection, no insurance) or sold (*limitación de disposición*). **This is the only
  query this service implements.**
- **Full report** (*informe completo*): a PDF with the full history (owners, mileage, inspections,
  charges…). Each one costs a fee (*tasa 4.1*, €8.67 in 2026) that has to be paid beforehand.

The data is the same that anyone can get one by one in the DGT's
[vehicle report web page](https://sede.dgt.gob.es/es/vehiculos/informacion-de-vehiculos/informe-de-un-vehiculo/);
the web service is for automating it.

## Getting access

Access is not self-service: the DGT has to register you. You need three things, and the DGT checks
all of them on every request:

1. **A digital certificate** issued by a certification authority accepted by
   [@firma](https://administracionelectronica.gob.es/ctt/afirma), the Spanish government's
   signature validation platform. A **personal certificate** (*certificado de persona física*) from the
   [FNMT](https://www.sede.fnmt.gob.es/certificados/persona-fisica) works: you do not need to have a
   company. You can check that a certificate is accepted by uploading its public part (`.cer`) to
   [VALIDe](https://valide.redsara.es/valide/validarCertificado/ejecutar.html).
2. **Your NIF** (Spanish tax ID; a CIF for a company), the one the certificate belongs to.
3. **A fixed public IPv4 address**: the DGT only lets in traffic from the addresses you give them.
   From any other address the connection simply times out. A home connection usually changes its
   IP from time to time, so use a server (a cloud VM is fine) and run this service on it.

### Step by step

1. **Read the documentation.** The DGT publishes a *Welcome Pack* with the WSDL files, the
   user manual and the WS-Security specifications:
   [welcomePack_INTV_WS_v03.rar](https://sede.dgt.gob.es/.galleries/vehiculos/informe-telematico-de-vehiculos/welcomePack_INTV_WS_v03.rar).
   They will later send you a newer version by email.
2. **Open a request** in the DGT's
   [requests and incidents form](https://sede.dgt.gob.es/es/formularios/gestion-peticiones-e-incidencias/index.html)
   (*Formulario de Peticiones e Incidencias*). You log in with your digital certificate, DNIe or
   Cl@ve. Then:
   - **Categoría:** *Registro de Vehículos*.
   - **Subcategoría:** *(INTV) Informe Telemático de Vehículos*.
   - **Descripción:** say that you are requesting access to the INTV web service (*alta en el
     servicio*), which report you need (the reduced one, *informe reducido*), what you will use it
     for, and who is asking (name or company, NIF/CIF, phone, email). If you do not have a company,
     say so and ask to be registered as an individual (*persona física*).
3. **Answer by email.** The DGT opens a ticket and writes back from its service desk, always in the
   same email thread: reply to their emails, do not open new requests. They will ask for:
   - the **public part of your certificate** (`.cer`), inside a `.zip` so that their mail server does
     not block it. Never send the private key (`.p12`/`.pfx`);
   - your **details for their user directory** (LDAP): company (or "individual"), the CIF/NIF of the
     certificate, contact person, phone, email and postal address;
   - the **public IP addresses** that will call the service.
4. **Wait for the confirmation.** They register you first in **pre-production** (*preproducción*),
   an environment with fake vehicles, and send you its endpoint URL. The production URL is sent
   on request once you have tested. In our case it took three weeks from the request to
   pre-production access, a week and a half of which was us taking time to answer.

If something does not work, you ask in the same email thread.

### What the DGT does not tell you

Things we found out while integrating, missing or unclear in the manual:

- **Signature only.** Requests are signed with WS-Security (XML-DSig, RSA-SHA1, exclusive
  canonicalization) over the SOAP `Body` and a `Timestamp`, with the certificate in a
  `BinarySecurityToken`. The manual's example also has a `UsernameToken` with a user and password:
  it is **not** needed.
- **The DOI field** of the reduced report: we send the NIF/CIF registered with the DGT, and it works.
- **Responses** carry a `numeroSerie` field that is not in the published XML schema.
- **They are slow:** a query that finds the vehicle takes 10–30 seconds.
- **A request without a signature** is answered with a SOAP fault *No se ha encontrado el
  certificado firmante en el documento XML*: a quick way to check that your IP is already allowed.

## Your certificate as a PEM file

The service reads a PEM file with the certificate and its private key. Export the certificate from
your browser or operating system **with its private key** as a `.p12`/`.pfx` file protected by a
password (or use the backup you made when you installed it), then convert it with OpenSSL:

```sh
# Many .p12 files (ours included) use old ciphers such as RC2, which OpenSSL 3 only reads with -legacy.
openssl pkcs12 -legacy -in certificate.p12 -out certificate.pem
```

OpenSSL asks for the `.p12` password and then for a new one to encrypt the key inside the PEM: that
is `CERT_PASSPHRASE`.

If the private key was installed as *non-exportable* (Windows lets you choose when importing), it
cannot be taken out of the system: you will need to get a new certificate from the FNMT and, this
time, keep a `.p12` backup.

## Configuration

Through command-line arguments, environment variables or a `.env` file, in that order of priority
(see [konfuz](https://github.com/victor141516/konfuz)). `bun src/index.ts --help` lists them.

| Environment variable | Argument | Default | Description |
|---|---|---|---|
| `CERT_PATH` | `--cert-path` | (required) | PEM file with the certificate and its private key. If it also holds the CA chain, the certificate matching the key is used |
| `CERT_PASSPHRASE` | `--cert-passphrase` | — | Passphrase of the private key, if the PEM keeps it encrypted |
| `NIF` | `--nif` | (required) | NIF/CIF registered with the DGT, sent as the DOI of every query |
| `ENDPOINT` | `--endpoint` | (required) | URL of the `ServicioInformesReducidoIntv` web service that the DGT sends you |
| `TIMEOUT_MS` | `--timeout-ms` | `30000` | How long to wait for the DGT, in milliseconds |
| `PORT` | `--port` | `3000` | HTTP port |

## Running

With Bun 1.3:

```sh
bun install
bun src/index.ts --cert-path certificate.pem --nif 12345678Z --endpoint https://…
```

With Docker:

```sh
docker build -t dgt-intv .
docker run -d --name dgt-intv -p 127.0.0.1:3000:3000 \
  -v "$PWD/certificate.pem:/run/secrets/cert.pem:ro" \
  -e CERT_PATH=/run/secrets/cert.pem -e CERT_PASSPHRASE -e NIF=12345678Z -e ENDPOINT=https://… \
  dgt-intv
```

- The image runs as the `bun` user (uid 1000), which has to be able to read the mounted PEM.
- Arguments after the image name are passed to the service (`… dgt-intv --timeout-ms 45000`).
- The DGT only sees the IPv4 address the container goes out from: check that it is the registered
  one.

## API

### `GET /vehicles/:plate`

Looks up the reduced report of a vehicle. The plate is normalized before the query (upper case,
no spaces or hyphens: `1234-bbb` becomes `1234BBB`) and may only contain letters and digits.

| Status | When | Body |
|---|---|---|
| `200` | The DGT returned the report (`codigoRetorno` is `INTV000`) | The report |
| `422` | The DGT answered with another code, e.g. `INTV401`, a plate with no vehicle | `codigoRetorno` and `descripcionRetorno` |
| `400` | The plate has characters other than letters and digits | `{ "error": "invalid_plate", "message": … }` |
| `502` | The DGT answered with a SOAP fault (wrong signature, certificate not registered…) | `{ "error": "dgt_fault", "code": …, "message": … }` |
| `502` | The DGT answered something that is not a report | `{ "error": "dgt_unexpected_response" }` |
| `502` | The DGT could not be reached | `{ "error": "dgt_unreachable", "message": … }` |
| `504` | The DGT did not answer within `TIMEOUT_MS`, which is also what happens when your IP is not registered | `{ "error": "dgt_timeout", "message": … }` |

The report keeps the DGT's own field names, in Spanish, so they can be looked up in the DGT's
documentation. Text values are trimmed (the DGT pads some with spaces). Every field the DGT sends is
passed through, including ones that are not listed here:

| Field | Meaning |
|---|---|
| `codigoRetorno` | DGT return code: `INTV000` when the report was generated. The manual in the Welcome Pack lists the rest |
| `descripcionRetorno` | Text of the return code, in Spanish |
| `marca` | Make |
| `modelo` | Model |
| `combustible` | Fuel (`DIESEL`, `GASOLINA`, `ELECTRICO`…) |
| `fechaPrimeraMatricula` | Date of first registration (ISO 8601) |
| `estadoVerificacion` | `SIN_INCIDENCIAS` (nothing recorded), `CON_INCIDENCIAS` (something recorded stops the vehicle from being driven or sold) or `CON_AVISOS` (something recorded as a warning) |
| `matricula` | The plate that was looked up |
| `bastidor`, `nive`, `numeroSerie` | VIN, electronic vehicle ID (NIVE) and serial number. The reduced report hides them: always `--`. `numeroSerie` is not in the published schema |
| `fechaSolicitud` | When the DGT generated the report |

## Development

```sh
bun install
bun run typecheck
```

`src/intv.ts` builds and signs the SOAP request and reads the response, `src/credentials.ts` loads
the PEM, and `src/index.ts` is the HTTP server.
