import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const SERVER_ENTRY = path.join(ROOT_DIR, 'server/server.js');
const STARTUP_TIMEOUT_MS = 15_000;

function listenOnRandomPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      assert(address && typeof address !== 'string');
      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

function waitForOutput(child, expected, diagnostics) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Legacy server did not become ready: ${diagnostics.join('').trim()}`
        )
      );
    }, STARTUP_TIMEOUT_MS);

    const onData = (chunk) => {
      diagnostics.push(chunk.toString());
      if (diagnostics.join('').includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Legacy server exited before readiness (${String(code)}/${String(signal)}): ${diagnostics.join('').trim()}`
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    let pendingReader;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out opening the legacy Socket.IO WebSocket'));
    }, STARTUP_TIMEOUT_MS);
    socket.addEventListener('message', (event) => {
      const message = String(event.data);
      if (pendingReader?.predicate(message)) {
        const { resolve: resolveReader, timeout: readerTimeout } =
          pendingReader;
        pendingReader = undefined;
        clearTimeout(readerTimeout);
        resolveReader(message);
      } else {
        messages.push(message);
      }
    });
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve({
          socket,
          next(predicate) {
            const index = messages.findIndex(predicate);
            if (index >= 0) {
              return Promise.resolve(messages.splice(index, 1)[0]);
            }
            assert.equal(pendingReader, undefined);
            return new Promise((resolveReader, rejectReader) => {
              const readerTimeout = setTimeout(() => {
                pendingReader = undefined;
                rejectReader(
                  new Error(
                    `Timed out waiting for a Socket.IO protocol message; received ${JSON.stringify(messages)}`
                  )
                );
              }, STARTUP_TIMEOUT_MS);
              pendingReader = {
                predicate,
                resolve: resolveReader,
                timeout: readerTimeout,
              };
            });
          },
        });
      },
      { once: true }
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('Could not open the legacy Socket.IO WebSocket'));
      },
      { once: true }
    );
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

test('updated legacy production dependencies preserve HTTP, SQLite, and Socket.IO startup', async (t) => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'ptcgsim-legacy-smoke-'));
  await mkdir(path.join(workDir, 'database'));
  const port = await listenOnRandomPort();
  const diagnostics = [];
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: workDir,
    env: {
      ...process.env,
      ADMIN_PASSWORD: 'dependency-smoke-password',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    await stopChild(child);
    await rm(workDir, { recursive: true, force: true });
  });

  await waitForOutput(
    child,
    `Server is running at http://localhost:${port}`,
    diagnostics
  );

  const rootResponse = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { Origin: 'https://compatibility.invalid' },
    signal: AbortSignal.timeout(STARTUP_TIMEOUT_MS),
  });
  assert.equal(rootResponse.status, 200);
  assert.equal(rootResponse.headers.get('access-control-allow-origin'), '*');
  assert.match(await rootResponse.text(), /<!DOCTYPE html>/i);

  const missingImportResponse = await fetch(
    `http://127.0.0.1:${port}/import?key=missing`,
    { signal: AbortSignal.timeout(STARTUP_TIMEOUT_MS) }
  );
  assert.equal(missingImportResponse.status, 404);
  assert.deepEqual(await missingImportResponse.json(), {
    error: 'Key not found',
  });

  const socketConnection = await openSocket(
    `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`
  );
  const { socket } = socketConnection;
  t.after(() => socket.close());
  assert.match(
    await socketConnection.next((message) => message.startsWith('0{')),
    /^0\{.*"sid":/
  );
  socket.send('40');
  await socketConnection.next((message) => message.startsWith('40'));
  socket.send('42["joinGame","dependency-smoke","Smoke",false]');
  const joinMessage = await socketConnection.next((message) =>
    message.startsWith('42["joinGame"')
  );
  assert.equal(JSON.parse(joinMessage.slice(2))[0], 'joinGame');
});
