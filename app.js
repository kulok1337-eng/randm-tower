/**
 * RICK TOWER — мини-сервер для Bothost.
 * Раздаёт файлы из этой же папки и, если задан BOT_TOKEN,
 * отвечает в Telegram на /start кнопкой запуска Mini App.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const APP_URL = process.env.APP_URL || 'https://bot-1795350282-3904-efim111.bothost.tech/';

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

  if (BLOCKED.indexOf(path.basename(filePath)) >= 0) return send(res, 404, 'Not found');

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
  console.log('RICK TOWER server started on port ' + PORT);
  if (BOT_TOKEN) startBot();
});

/* --------------------------------------------------------------------------
   Простой Telegram-бот на long polling, без внешних библиотек.
   Отвечает на /start и /play кнопкой, открывающей Mini App.
   Токен берётся из переменной окружения BOT_TOKEN и в коде его нет.
   -------------------------------------------------------------------------- */

function tgApi(method, payload) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify(payload || {});
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + BOT_TOKEN + '/' + method,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 35000
    }, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function startBot() {
  let offset = 0;

  const keyboard = {
    inline_keyboard: [[{ text: '🥒 Играть', web_app: { url: APP_URL } }]]
  };

  const text =
    '🥒 RICK TOWER — аркада про башню из огурчиков.\n\n' +
    'Тапай вовремя, ставь огурчик ровно, лови ИДЕАЛЬНО и собирай кристаллы.\n' +
    'Скины открываются за кристаллы.\n\n' +
    'Жми кнопку ниже 👇';

  async function poll() {
    try {
      const data = await tgApi('getUpdates', { offset: offset, timeout: 25 });
      if (data && Array.isArray(data.result)) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          const msg = upd.message;
          if (!msg || !msg.text) continue;

          if (/^\/(start|play)(@\w+)?/.test(msg.text)) {
            await tgApi('sendMessage', {
              chat_id: msg.chat.id,
              text: text,
              reply_markup: keyboard,
              disable_web_page_preview: true
            });
          } else if (/^\/help/.test(msg.text)) {
            await tgApi('sendMessage', {
              chat_id: msg.chat.id,
              text: 'Правила: тапни, когда огурчик над башней — он опустится. ' +
                    'Лишнее отрежется, полный промах заканчивает игру.',
              reply_markup: keyboard
            });
          }
        }
      }
    } catch (e) {
      // сеть/токен — просто пробуем снова
    }
    setTimeout(poll, 1000);
  }

  poll();
  console.log('Telegram bot polling started');
}
