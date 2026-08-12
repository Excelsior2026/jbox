/**
 * Splits a SQL script into top-level statements, honoring single quotes, dollar
 * quoting, and comments, so semicolons inside DO blocks or string literals are
 * not treated as statement boundaries.
 *
 * Shared by run-sql-check.mjs (check suites) and seed-dev-tenant.mjs (the dev
 * tenant seed), so both follow the same parsing rules.
 */
export function splitStatements(source) {
  const statements = [];
  let current = '';
  let i = 0;
  let state = 'normal';

  const isDollarStart = (pos) => {
    if (source[pos] !== '$') return null;
    let j = pos + 1;
    while (/[A-Za-z0-9_]/.test(source[j] ?? '')) j += 1;
    return source[j] === '$' ? j : null;
  };

  while (i < source.length) {
    const char = source[i];

    if (state === 'normal') {
      if (char === '-' && source[i + 1] === '-') {
        state = 'line-comment';
        i += 2;
        continue;
      }
      if (char === '/' && source[i + 1] === '*') {
        state = 'block-comment';
        i += 2;
        continue;
      }
      if (char === "'") {
        state = 'single-quote';
        current += char;
        i += 1;
        continue;
      }
      const dollarEnd = isDollarStart(i);
      if (dollarEnd !== null) {
        state = `dollar:${source.slice(i, dollarEnd + 1)}`;
        current += source.slice(i, dollarEnd + 1);
        i = dollarEnd + 1;
        continue;
      }
      if (char === ';') {
        if (current.trim()) statements.push(current.trim());
        current = '';
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'normal';
        current += '\n';
      }
      i += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && source[i + 1] === '/') {
        state = 'normal';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'single-quote') {
      if (char === "'" && source[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }
      if (char === "'") {
        state = 'normal';
        current += char;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (state.startsWith('dollar:')) {
      const tag = state.slice('dollar:'.length);
      if (source.startsWith(tag, i)) {
        current += tag;
        state = 'normal';
        i += tag.length;
        continue;
      }
      current += char;
      i += 1;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
