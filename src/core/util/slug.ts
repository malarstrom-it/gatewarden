/**
 * DNS label sanitisation.
 *
 * Follows the `CI_COMMIT_REF_SLUG` convention of the common CI systems:
 * lower-case, everything except `0-9` and `a-z` replaced with `-`, no
 * leading or trailing `-`, at most 63 characters.
 */

const MAX_LABEL_LENGTH = 63;

/**
 * Turn an arbitrary string into a DNS-safe label.
 *
 * Unicode input is normalised (NFKD) and diacritics are dropped so that
 * `Ünïcode` becomes `unicode` rather than `nicode`.
 */
export function slugify(input: string): string {
  const folded = String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const lowered = folded.toLowerCase();
  let out = '';
  for (const ch of lowered) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) out += ch;
    else out += '-';
  }
  out = out.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  if (out.length > MAX_LABEL_LENGTH) {
    out = out.slice(0, MAX_LABEL_LENGTH).replace(/-+$/, '');
  }
  return out;
}

/** True when the label is a usable DNS label. */
export function isValidLabel(label: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label) && label.length <= MAX_LABEL_LENGTH;
}

/**
 * Build the FQDN for a registration: `<branch>.<project>.<zone>`.
 */
export function buildFqdn(project: string, branch: string, zone: string): string {
  return `${slugify(branch)}.${slugify(project)}.${zone}`;
}

/**
 * The zone of a host name that was built by `buildFqdn`.
 *
 * The inverse of `buildFqdn`: the zone is everything after the branch and
 * the project. A host name that was built without a zone has none, and a
 * host name that was not built by `buildFqdn` has none either.
 */
export function zoneOfFqdn(fqdn: string): string {
  if (typeof fqdn !== 'string') return '';
  const labels = fqdn.split('.');
  if (labels.length < 3) return '';
  return labels.slice(2).join('.');
}
