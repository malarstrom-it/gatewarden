/**
 * Minimal YAML parser used by the tests to prove the rendered document
 * parses back into the expected object. Supports the subset the emitter
 * produces: nested maps, sequences, quoted and plain scalars.
 */

export type YamlValue = unknown;

interface Line {
  indent: number;
  text: string;
}

function parseScalar(raw: string): YamlValue {
  const text = raw.trim();
  if (text === '') return '';
  if (text.startsWith('"')) return JSON.parse(text) as YamlValue;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseKey(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('"')) return JSON.parse(text) as string;
  return text;
}

export function parseYaml(source: string): YamlValue {
  const lines: Line[] = [];
  for (const raw of source.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    lines.push({ indent: raw.length - raw.trimStart().length, text: raw.trim() });
  }

  function parseBlock(index: number, indent: number): [YamlValue, number] {
    if (index >= lines.length) return [null, index];

    if (lines[index].text.startsWith('- ') || lines[index].text === '-') {
      const items: YamlValue[] = [];
      let cursor = index;
      while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith('-')) {
        const rest = lines[cursor].text === '-' ? '' : lines[cursor].text.slice(2).trim();
        if (rest === '') {
          const [value, next] = parseBlock(cursor + 1, indent + 2);
          items.push(value);
          cursor = next;
          continue;
        }
        if (/^[^:\s][^:]*:(\s|$)/.test(rest)) {
          // inline mapping start: "- key: value"
          const childIndent = indent + 2;
          const synthetic: Line[] = [{ indent: childIndent, text: rest }];
          const restLines = lines.slice(cursor + 1);
          let end = cursor + 1;
          while (end < lines.length && lines[end].indent > indent) end += 1;
          synthetic.push(...restLines.slice(0, end - cursor - 1));
          const saved = lines.splice(0, lines.length, ...synthetic);
          const [value] = parseBlock(0, childIndent);
          lines.splice(0, lines.length, ...saved);
          items.push(value);
          cursor = end;
          continue;
        }
        items.push(parseScalar(rest));
        cursor += 1;
      }
      return [items, cursor];
    }

    const map: Record<string, YamlValue> = {};
    let cursor = index;
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const line = lines[cursor].text;
      const colon = line.indexOf(':');
      if (colon < 0) throw new Error(`cannot parse YAML line: ${line}`);
      const key = parseKey(line.slice(0, colon));
      const rest = line.slice(colon + 1).trim();
      if (rest !== '') {
        map[key] = parseScalar(rest);
        cursor += 1;
        continue;
      }
      const childIndent = cursor + 1 < lines.length ? lines[cursor + 1].indent : indent + 2;
      const [value, next] = parseBlock(cursor + 1, childIndent);
      map[key] = value;
      cursor = next;
    }
    return [map, cursor];
  }

  const [value] = parseBlock(0, lines.length > 0 ? lines[0].indent : 0);
  return value;
}
