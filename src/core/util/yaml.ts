/**
 * Minimal YAML emitter (zero runtime dependencies).
 *
 * Supports the subset the Traefik dynamic configuration document needs:
 * nested maps, sequences, strings, numbers, booleans and null. Strings are
 * emitted as double-quoted JSON scalars, which is valid YAML 1.2.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue | undefined };

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarToYaml(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return JSON.stringify(value);
}

function keyToYaml(key: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
}

function emit(value: YamlValue, depth: number): string[] {
  const pad = '  '.repeat(depth);

  if (isScalar(value)) return [pad + scalarToYaml(value as string | number | boolean | null)];

  if (Array.isArray(value)) {
    if (value.length === 0) return [pad + '[]'];
    const lines: string[] = [];
    for (const item of value) {
      if (isScalar(item)) {
        lines.push(`${pad}- ${scalarToYaml(item as string | number | boolean | null)}`);
        continue;
      }
      const sub = emit(item, depth + 1);
      if (sub.length === 0) {
        lines.push(`${pad}- {}`);
        continue;
      }
      sub[0] = `${pad}- ${sub[0].trimStart()}`;
      lines.push(...sub);
    }
    return lines;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return [pad + '{}'];
    const lines: string[] = [];
    for (const [key, child] of entries) {
      if (isScalar(child)) {
        lines.push(`${pad}${keyToYaml(key)}: ${scalarToYaml(child as string | number | boolean | null)}`);
      } else if (Array.isArray(child) && child.length === 0) {
        lines.push(`${pad}${keyToYaml(key)}: []`);
      } else if (isPlainObject(child) && Object.keys(child).length === 0) {
        lines.push(`${pad}${keyToYaml(key)}: {}`);
      } else {
        lines.push(`${pad}${keyToYaml(key)}:`);
        lines.push(...emit(child as YamlValue, depth + 1));
      }
    }
    return lines;
  }

  return [pad + 'null'];
}

/** Render a value as a YAML document. */
export function toYaml(value: YamlValue): string {
  return emit(value, 0).join('\n') + '\n';
}
