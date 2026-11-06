/**
 * A throwaway certificate for the tests.
 *
 * The setup wizard fetches the public URL over HTTPS (§9.5), so the proxy
 * double has to serve TLS with a certificate the test process trusts. The
 * certificate is generated with OpenSSL, in the test's own directory, and
 * it is thrown away with it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestCertificate {
  /** The private key, in PEM. */
  key: string;
  /** The certificate, in PEM. It is its own certificate authority. */
  cert: string;
  /** Where the certificate was written, so that it can be trusted. */
  certFile: string;
  /** The directory the certificate lives in. */
  dir: string;
}

/** Is OpenSSL there? */
export function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a self-signed certificate for a host name.
 *
 * The name may start with a wildcard (`*.example.test`). The certificate
 * is its own authority: a client that trusts it trusts the certificate.
 */
export function makeCertificate(hostName: string): TestCertificate | undefined {
  if (!hasOpenssl()) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-cert-'));
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyFile,
        '-out',
        certFile,
        '-days',
        '1',
        '-subj',
        `/CN=${hostName}`,
        '-addext',
        `subjectAltName=DNS:${hostName}`,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
  return {
    key: fs.readFileSync(keyFile, 'utf8'),
    cert: fs.readFileSync(certFile, 'utf8'),
    certFile,
    dir,
  };
}
