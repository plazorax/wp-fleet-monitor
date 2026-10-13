import { isIP } from 'node:net';
import { connect } from 'node:tls';

export interface CertificateInfo {
  validTo: Date;
  /** Whether the chain and hostname verified against the system trust store. */
  authorized: boolean;
  /** OpenSSL / Node error code when `authorized` is false, e.g. `CERT_HAS_EXPIRED`. */
  authorizationError: string | null;
  issuer: string | null;
}

/** Reads the certificate a server presents. Injected so tests never open sockets. */
export type TlsProbe = (host: string, port: number, timeoutMs: number) => Promise<CertificateInfo>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const probeCertificate: TlsProbe = (host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = connect({
      host,
      port,
      // SNI must be a hostname, never an IP address.
      ...(isIP(host) === 0 ? { servername: host } : {}),
      // Verification still runs and is reported through `authorized`; we only
      // need the handshake to complete so expired or mismatched certs can be read.
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });

    socket.once('secureConnect', () => {
      socket.setTimeout(0);
      const certificate = socket.getPeerCertificate();
      const authorizationError = socket.authorizationError as Error | string | null | undefined;
      const authorized = socket.authorized;
      // Only the handshake is needed; destroy rather than end() so a peer that never
      // closes its side cannot keep the socket, and the process, alive.
      socket.destroy();
      if (!certificate.valid_to) {
        reject(new Error('server presented no certificate'));
        return;
      }
      resolve({
        validTo: new Date(certificate.valid_to),
        authorized,
        authorizationError: authorizationError ? String(authorizationError) : null,
        issuer: first(certificate.issuer.O) ?? first(certificate.issuer.CN) ?? null,
      });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`TLS handshake timed out after ${timeoutMs} ms`));
    });
    // `on`, not `once`: a second error must not become an unhandled 'error' event.
    socket.on('error', (error: Error) => {
      reject(error);
    });
  });
