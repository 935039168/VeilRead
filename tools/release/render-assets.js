#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { assetSpecs } = require('./config.js');
const { readPngSize } = require('./audit.js');

const root = path.resolve(__dirname, '../..');
const outputDir = path.join(root, 'store/assets/generated');
const ASSETS = assetSpecs.map((asset) => ({ ...asset }));

function browserCandidates() {
  const env = process.env;
  return [
    env.VEILREAD_CHROME,
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
}

function findBrowser() {
  return browserCandidates().find((candidate) => fs.existsSync(candidate)) || null;
}

function contentType(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative || 'site/index.html');
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
      response.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function assetUrl(asset, port) {
  if (asset.source === 'promo') return `http://127.0.0.1:${port}/store/assets/source/promo.html?kind=${asset.kind}&locale=${asset.locale || 'zh-CN'}`;
  return `http://127.0.0.1:${port}/test/store-assets.html?scene=${asset.scene}&locale=${asset.locale}`;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    const timer = options.timeout ? setTimeout(() => {
      child.kill();
      reject(new Error(`process timed out after ${options.timeout}ms`));
    }, options.timeout) : null;
    child.once('close', (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function renderAssets() {
  const browser = findBrowser();
  if (!browser) throw new Error('Chrome or Edge was not found. Set VEILREAD_CHROME to the browser executable path.');
  fs.mkdirSync(outputDir, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'veilread-assets-'));
  try {
    for (const asset of ASSETS) {
      const output = path.join(outputDir, asset.name);
      fs.rmSync(output, { force: true });
      if (asset.source === 'copy') {
        fs.copyFileSync(path.join(root, asset.input), output);
      } else {
        const result = await runProcess(browser, [
          '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-default-apps',
          '--force-device-scale-factor=1', `--window-size=${asset.width},${asset.height}`,
          '--virtual-time-budget=1800', `--user-data-dir=${profile}`, `--screenshot=${output}`, assetUrl(asset, port),
        ], { timeout: 30000 });
        if (result.status !== 0) throw new Error(`${asset.name}: browser render failed: ${result.stderr || result.stdout}`);
      }
      const actual = readPngSize(fs.readFileSync(output));
      if (actual.width !== asset.width || actual.height !== asset.height) {
        throw new Error(`${asset.name}: expected ${asset.width}x${asset.height}, got ${actual.width}x${actual.height}`);
      }
      console.log(`rendered ${asset.name} (${asset.width}x${asset.height})`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

module.exports = { ASSETS, browserCandidates, findBrowser, runProcess, renderAssets };

if (require.main === module) {
  renderAssets().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
