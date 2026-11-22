/**
 * DRAG TOWER — мини-сервер для Bothost.
 * Раздаёт файлы из этой же папки. Всего один уровень, без public/.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT = __dirname;

// эти файлы наружу не отдаём
const BLOCKED = ['app.js', 'package.json', 'package-lock.json'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(function (req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    return send(res, 400, 'Bad request');
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.resolve(ROOT, '.' + urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  const name = path.basename(filePath);
  if (BLOCKED.indexOf(name) >= 0) return send(res, 404, 'Not found');

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) return send(res, 404, 'Not found');

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath)
      .on('error', function () { res.end(); })
      .pipe(res);
  });
});

server.listen(PORT, HOST, function () {
  console.log('DRAG TOWER server started on port ' + PORT);
});
