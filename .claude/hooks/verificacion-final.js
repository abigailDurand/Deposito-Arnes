'use strict';
// Stop: antes de cerrar la sesión fuerza `bash init.sh --rapido` y avisa al humano del resultado.
const { spawnSync } = require('child_process');

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let datos = {};
  try {
    datos = JSON.parse(entrada);
  } catch {
    // sin entrada: se verifica igual
  }
  const raiz = process.env.CLAUDE_PROJECT_DIR || datos.cwd || process.cwd();
  const r = spawnSync('bash init.sh --rapido', {
    cwd: raiz, shell: true, encoding: 'utf8', timeout: 180000,
  });
  const limpia = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const mensaje = r.status === 0
    ? '[harness] init.sh --rapido OK'
    : `[harness] init.sh FALLÓ — revísalo antes de cerrar:\n${limpia(`${r.stdout || ''}${r.stderr || ''}`)
      .split('\n').filter((l) => /\[(FAIL|WARN)\]/.test(l)).slice(-15).join('\n')}`;
  process.stdout.write(JSON.stringify({ systemMessage: mensaje }));
  process.exit(0);
});
