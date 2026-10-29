/**
 * The certificates of the test environment (D11, §11.1).
 *
 * The live system terminates TLS with the user's ACME certificates. The
 * test cannot: an ACME certificate needs a public domain and a public
 * authority. The test therefore makes its own authority — a self-signed
 * CA — and a certificate for the test domain, and the test client trusts
 * that CA and nothing else.
 *
 * The certificates are made with OpenSSL, the way the tests of the
 * repository already make their throwaway certificates
 * (`test/helpers/cert.ts`). OpenSSL is not a dependency of the package:
 * only the test environment needs it, and only on Linux and macOS.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface TestCertificates {
  /** The directory the certificates live in. */
  dir: string;
  /** The certificate authority, in PEM. */
  caFile: string;
  /** The certificate of the test domain, in PEM. */
  certFile: string;
  /** The private key of the test domain, in PEM. */
  keyFile: string;
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

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Make the certificates of the test environment.
 *
 * The authority is its own certificate (`CA:TRUE`), and the certificate
 * of the domain is signed by it. The names the certificate covers are
 * the domain itself, the wildcard of the domain and the wildcard of the
 * test project — the domain the routers ask for (§11.2).
 */
export function generateCertificates(dir: string, names: string[]): TestCertificates {
  if (!hasOpenssl()) {
    throw new Error('the test environment needs OpenSSL to make its certificates');
  }
  fs.mkdirSync(dir, { recursive: true });
  const caFile = path.join(dir, 'ca.pem');
  const caKey = path.join(dir, 'ca.key');
  const certFile = path.join(dir, 'certificate.pem');
  const keyFile = path.join(dir, 'certificate.key');

  const san = names.map((name) => `DNS:${name}`).join(',');
  const caConfig = path.join(dir, 'ca.cnf');
  fs.writeFileSync(
    caConfig,
    [
      '[req]',
      'distinguished_name=dn',
      'x509_extensions=v3',
      'prompt=no',
      '[dn]',
      'CN=dev-gateway test CA',
      '[v3]',
      `subjectAltName=${san}`,
      'basicConstraints=critical,CA:TRUE',
      'keyUsage=digitalSignature,keyEncipherment,keyCertSign',
      '',
    ].join('\n'),
  );
  openssl(
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      caKey,
      '-out',
      caFile,
      '-days',
      '3650',
      '-config',
      caConfig,
      '-extensions',
      'v3',
    ],
    dir,
  );

  const leafConfig = path.join(dir, 'certificate.cnf');
  fs.writeFileSync(
    leafConfig,
    [
      '[req]',
      'distinguished_name=dn',
      'prompt=no',
      '[dn]',
      `CN=${names[0] ?? 'gwtest.local'}`,
      '[v3]',
      `subjectAltName=${san}`,
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      '',
    ].join('\n'),
  );
  const csr = path.join(dir, 'certificate.csr');
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', csr, '-config', leafConfig], dir);
  openssl(
    [
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      caFile,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      certFile,
      '-days',
      '3650',
      '-extfile',
      leafConfig,
      '-extensions',
      'v3',
    ],
    dir,
  );
  fs.rmSync(csr, { force: true });

  return { dir, caFile, certFile, keyFile };
}
