// Stellt sicher, dass die Dev-Infrastruktur läuft: PostgreSQL (5432),
// Redis (6379) und MinIO (9000). Läuft bereits alles, passiert nichts.
// Fehlende Dienste werden bevorzugt über Docker Compose gestartet
// (infra/docker-compose.yml, nur die fehlenden Services – so kollidiert
// Docker nicht mit einer teilweise laufenden portablen Infra); ohne
// erreichbaren Docker-Daemon greift der portable Fallback
// (scripts/dev-infra.ps1, siehe PROGRESS.md "Dev-Umgebung").
//
// Aufruf: node scripts/ensure-infra.mjs  (bzw. npm run dev:infra)
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// name = Anzeige, service = Name in docker-compose.yml
const SERVICES = [
  { name: 'PostgreSQL', service: 'postgres', port: 5432 },
  { name: 'Redis', service: 'redis', port: 6379 },
  { name: 'MinIO', service: 'minio', port: 9000 },
];

/** true, wenn auf 127.0.0.1:port etwas lauscht. */
function checkPort(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (up) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function missingServices() {
  const ups = await Promise.all(SERVICES.map((s) => checkPort(s.port)));
  return SERVICES.filter((_, i) => !ups[i]);
}

/** Docker-Daemon erreichbar? (startet Docker Desktop bewusst NICHT selbst) */
function dockerAvailable() {
  const res = spawnSync('docker', ['info'], {
    stdio: 'ignore',
    timeout: 15_000,
    windowsHide: true,
  });
  return res.status === 0;
}

function startViaDocker(missing) {
  console.log(`[infra] Starte über Docker Compose: ${missing.map((s) => s.name).join(', ')}`);
  const res = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'up',
      '-d',
      '--wait', // wartet auf die Healthchecks
      ...missing.map((s) => s.service),
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  return res.status === 0;
}

function startPortable() {
  console.log('[infra] Kein Docker-Daemon erreichbar – starte portable Infrastruktur');
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\\dev-infra.ps1'],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  return res.status === 0;
}

/** Wartet, bis alle Ports erreichbar sind (Deckel timeoutMs). */
async function waitUntilUp(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const missing = await missingServices();
    if (missing.length === 0) return [];
    if (Date.now() >= deadline) return missing;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const missing = await missingServices();
if (missing.length === 0) {
  console.log('[infra] PostgreSQL, Redis und MinIO laufen bereits');
  process.exit(0);
}

if (dockerAvailable()) {
  startViaDocker(missing);
} else {
  startPortable();
}

const stillMissing = await waitUntilUp();
if (stillMissing.length > 0) {
  console.error(
    `[infra] Nicht erreichbar: ${stillMissing
      .map((s) => `${s.name} (Port ${s.port})`)
      .join(', ')}.\n` +
      '[infra] Einrichtung siehe README.md ("Voraussetzungen") bzw. PROGRESS.md ("Dev-Umgebung").',
  );
  process.exit(1);
}
console.log('[infra] Infrastruktur bereit');
