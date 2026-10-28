/**
 * DNS label sanitisation.
 *
 * Follows the GitLab `CI_COMMIT_REF_SLUG` convention: lower-case, everything
 * except `0-9` and `a-z` replaced with `-`, no leading or trailing `-`, at
 * most 63 characters.
 * https://docs.gitlab.com/ci/variables/predefined_variables/
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
