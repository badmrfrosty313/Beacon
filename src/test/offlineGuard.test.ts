// @vitest-environment node
//
// B-003 offline guard: a reproducible, static check that the project cannot reach the network.
// It complements (does not replace) the manual airplane-mode check in docs/OFFLINE-VERIFICATION.md.
//
// If one of these tests fails because you intentionally added a dependency, plugin or
// permission, that is a security-relevant decision: record it in DECISIONS.md, get owner
// approval, and only then update the allowlist here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

/** Names of the keys declared under a Cargo.toml table such as [dependencies]. */
function cargoSection(toml: string, section: string): string[] {
  const names: string[] = [];
  let inSection = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inSection = line === `[${section}]`;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (inSection && match?.[1]) names.push(match[1]);
  }
  return names.sort();
}

function cspDirective(csp: string, name: string): string[] {
  const directive = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

describe('frontend source contains no network access', () => {
  const sources = walk('src', (file) => /\.(ts|tsx|css)$/.test(file)).filter(
    (file) => !file.startsWith(join('src', 'test')) && !/\.test\.tsx?$/.test(file),
  );

  it('finds the application sources it is supposed to scan', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain(join('src', 'main.tsx'));
  });

  const forbidden: [string, RegExp][] = [
    ['fetch()', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['WebSocket', /\bWebSocket\b/],
    ['EventSource', /\bEventSource\b/],
    ['navigator.sendBeacon', /sendBeacon/],
    ['importScripts', /\bimportScripts\b/],
    ['a remote URL', /https?:\/\//],
    ['CSS @import', /@import\b/],
  ];

  it.each(forbidden)('has no use of %s', (_label, pattern) => {
    const offenders = sources.filter((file) =>
      pattern.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('index.html loads nothing from the network', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link[^>]+rel=["']?(stylesheet|preload|prefetch|preconnect)/i);
    expect(html).not.toMatch(/<script[^>]+src=["'](?!\/src\/main\.tsx)/i);
  });
});

describe('Tauri configuration is locked down', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json')) as {
    app: { security: { csp: string; devCsp: string } };
  };

  it('production CSP allows only local content and Tauri IPC', () => {
    const { csp } = config.app.security;
    expect(cspDirective(csp, 'default-src')).toEqual(["'self'"]);
    expect(cspDirective(csp, 'connect-src').sort()).toEqual(['http://ipc.localhost', 'ipc:']);
    for (const directive of ['script-src', 'style-src']) {
      const sources = cspDirective(csp, directive);
      expect(sources, directive).toEqual(["'self'"]);
    }
    expect(csp).not.toMatch(/unsafe-eval|\*|https:|wss?:/);
    expect(cspDirective(csp, 'object-src')).toEqual(["'none'"]);
  });

  it('development CSP only adds the local Vite dev server', () => {
    const connect = cspDirective(config.app.security.devCsp, 'connect-src').sort();
    expect(connect).toEqual([
      'http://ipc.localhost',
      'http://localhost:1420',
      'ipc:',
      'ws://localhost:1420',
    ]);
  });

  it('the main window capability grants only core permissions', () => {
    const capability = JSON.parse(read('src-tauri/capabilities/default.json')) as {
      windows: string[];
      permissions: string[];
    };
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions.length).toBeGreaterThan(0);
    for (const permission of capability.permissions) {
      expect(permission, 'only core: permissions are allowed without review').toMatch(/^core:/);
    }
  });
});

describe('dependency allowlists', () => {
  it('Rust dependencies are limited to the reviewed set', () => {
    const toml = read('src-tauri/Cargo.toml');
    expect(cargoSection(toml, 'dependencies')).toEqual(['rusqlite', 'serde', 'tauri', 'thiserror']);
    expect(cargoSection(toml, 'build-dependencies')).toEqual(['tauri-build']);
    expect(cargoSection(toml, 'dev-dependencies')).toEqual(['serde_json', 'tempfile']);
  });

  it('JavaScript runtime dependencies are limited to the reviewed set', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@tauri-apps/api', 'react', 'react-dom']);
  });

  it('Rust sources register no Tauri plugins and use no sockets', () => {
    const rustFiles = walk('src-tauri/src', (file) => file.endsWith('.rs'));
    expect(rustFiles.length).toBeGreaterThan(5);
    for (const file of rustFiles) {
      const code = read(file)
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
      expect(code, `${file} must not register plugins`).not.toMatch(/\.plugin\s*\(/);
      expect(code, `${file} must not open sockets`).not.toMatch(
        /std::net|TcpStream|UdpSocket|reqwest|hyper|ureq/,
      );
    }
  });
});
