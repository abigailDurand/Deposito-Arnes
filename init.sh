#!/usr/bin/env bash
# init.sh — Verificación e inicialización del entorno de deposito-service
#
# Lo ejecuta el agente al COMENZAR una sesión y antes de declarar cualquier feature `done`.
# Si falla, la sesión no debe avanzar.
#
#   bash init.sh            verificación completa (unitarias + integración con PostgreSQL)
#   bash init.sh --rapido   sin integración (lo usa el hook al cerrar sesión)

set -u
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC}  %s\n" "$1"; }

RAPIDO=0
[ "${1:-}" = "--rapido" ] && RAPIDO=1
EXIT_CODE=0

echo "── 1. Verificando entorno ─────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  fail "node no está instalado"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Se requiere Node.js >= 22 (SPEC-00). Tienes $(node --version)"
  exit 1
fi
ok "node -> $(node --version)"

if command -v npm >/dev/null 2>&1; then
  ok "npm -> $(npm --version)"
else
  fail "npm no está instalado"
  EXIT_CODE=1
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "docker no está instalado (necesario para PostgreSQL y docker compose)"
elif ! docker info >/dev/null 2>&1; then
  warn "docker está instalado pero el daemon no responde (abre Docker Desktop)"
else
  ok "docker -> $(docker --version | cut -d, -f1)"
fi

echo ""
echo "── 2. Verificando archivos base del arnés ──────────────"

for f in AGENTS.md CLAUDE.md CHECKPOINTS.md feature_list.json progress/current.md progress/history.md \
         docs/architecture.md docs/conventions.md docs/verification.md \
         .claude/agents/leader.md .claude/agents/desarrolladorback.md \
         .claude/agents/tester.md .claude/agents/revisor.md specs-v2/manifest.yaml; do
  if [ ! -f "$f" ]; then
    fail "Falta archivo base: $f"
    EXIT_CODE=1
  fi
done
[ $EXIT_CODE -eq 0 ] && ok "Archivos base del arnés presentes"

echo ""
echo "── 3. Specs, estado y alcance ──────────────────────────"

node .harness/specs.js verificar || EXIT_CODE=1
node .harness/validar-features.js || EXIT_CODE=1
node .harness/alcance.js || EXIT_CODE=1

echo ""
echo "── 4. Ejecutando pruebas ───────────────────────────────"

if [ ! -f package.json ]; then
  warn "package.json no existe todavía (SPEC-00 pendiente): no hay pruebas que correr"
elif [ ! -d node_modules ]; then
  fail "Falta node_modules: ejecuta 'npm install'"
  EXIT_CODE=1
elif [ $RAPIDO -eq 1 ]; then
  if npm run --silent test:unit 2>&1; then
    ok "Pruebas unitarias en verde (modo --rapido: integración NO ejecutada)"
  else
    fail "Hay pruebas unitarias rotas"
    EXIT_CODE=1
  fi
else
  if npm test --silent 2>&1; then
    ok "Todas las pruebas en verde (unitarias + integración)"
  else
    fail "Hay pruebas rotas (¿está PostgreSQL arriba? 'docker compose up -d db')"
    EXIT_CODE=1
  fi
fi

echo ""
echo "── 5. Resumen ──────────────────────────────────────────"

if [ $EXIT_CODE -eq 0 ]; then
  if [ $RAPIDO -eq 1 ]; then
    ok "Entorno listo (verificación rápida). Para cerrar una feature corre 'bash init.sh' completo."
  else
    ok "Entorno listo. Puedes empezar a trabajar."
  fi
else
  fail "Entorno NO está listo. Resuelve los errores antes de avanzar."
fi

exit $EXIT_CODE
