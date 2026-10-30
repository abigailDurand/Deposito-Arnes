'use strict';
// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): PRY-R12, ningún agente modifica specs-v2/.
const path = require('path');

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let datos;
  try {
    datos = JSON.parse(entrada);
  } catch {
    process.exit(0);
  }
  const destino = datos.tool_input?.file_path || datos.tool_input?.notebook_path;
  if (!destino) process.exit(0);

  const raiz = process.env.CLAUDE_PROJECT_DIR || datos.cwd || process.cwd();
  const rel = path.relative(raiz, path.resolve(datos.cwd || raiz, destino)).split(path.sep).join('/');
  if (rel.startsWith('specs-v2/') || rel === '.harness/specs.sha256') {
    process.stderr.write(
      `[harness] Bloqueado: ${rel} es de solo lectura (PRY-R12). Si la spec es ambigua o `
      + 'contradictoria, pon la feature en blocked y explica la duda en progress/current.md.\n',
    );
    process.exit(2);
  }
  process.exit(0);
});
