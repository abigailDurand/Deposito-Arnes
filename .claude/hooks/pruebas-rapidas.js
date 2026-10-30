'use strict';
// PostToolUse (Edit|Write): tras tocar código, corre las unitarias y, si fallan, se lo dice al agente.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let datos;
  try {
    datos = JSON.parse(entrada);
  } catch {
    process.exit(0);
  }
  const raiz = process.env.CLAUDE_PROJECT_DIR || datos.cwd || process.cwd();
  const destino = datos.tool_input?.file_path || '';
  const rel = path.relative(raiz, path.resolve(raiz, destino)).split(path.sep).join('/');

  const tocaCodigo = /^(src|tests|db|mocks)\//.test(rel) && /\.(js|sql)$/.test(rel);
  const listo = fs.existsSync(path.join(raiz, 'package.json'))
    && fs.existsSync(path.join(raiz, 'node_modules'));
  if (!tocaCodigo || !listo) process.exit(0);

  const r = spawnSync('npm run --silent test:unit', {
    cwd: raiz, shell: true, encoding: 'utf8', timeout: 120000,
  });
  if (r.status === 0) process.exit(0);

  const salida = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-40).join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `[harness] Las pruebas unitarias fallan tras editar ${rel}:\n${salida}`,
    },
  }));
  process.exit(0);
});
