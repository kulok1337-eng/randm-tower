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
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DOMAIN = (process.env.DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const APP_URL = process.env.APP_URL ||
  (DOMAIN ? 'https://' + DOMAIN + '/' : 'https://bot-1795355360-3818-efim111.bothost.tech/');

/* Общий лидерборд: максимум 30 записей, по одной на игрока.
   Данные лежат в файле. На Bothost есть постоянная папка /app/data —
   используем её, иначе кладём рядом с игрой. */
const DATA_DIR = process.env.DATA_DIR ||
  (fs.existsSync('/app/data') ? '/app/data' : path.join(ROOT, 'data'));
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const TOP_LIMIT = 30;

function readScores() {
  try {
    const raw = fs.readFileSync(SCORES_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) { return {}; }
}

function writeScores(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SCORES_FILE, JSON.stringify(obj));
  } catch (e) { /* перезапуск не должен падать из-за файла */ }
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/* Проверка подписи Telegram: без неё счёт можно подделать запросом */
function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .map(function (e) { return e[0] + '=' + e[1]; })
      .sort()
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (calc !== hash) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch (e) { return null; }
}

function readBody(req, cb) {
  let body = '';
  req.on('data', function (chunk) {
    body += chunk;
    if (body.length > 100000) req.destroy();
  });
  req.on('end', function () { cb(body); });
}

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

  /* ---------------- Общий лидерборд ---------------- */
  if (urlPath === '/api/top') {
    const scores = readScores();
    const rows = Object.keys(scores)
      .map(function (k) { return scores[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, TOP_LIMIT);
    return json(res, 200, rows);
  }

  if (urlPath === '/api/score' && req.method === 'POST') {
    return readBody(req, function (raw) {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'bad json' }); }

      const user = verifyInitData(body.initData);
      if (!user && BOT_TOKEN) return json(res, 403, { error: 'bad signature' });

      const id = user && user.id ? String(user.id) : 'local';
      const name = user
        ? (user.username ? '@' + user.username
          : [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Игрок')
        : 'Игрок';

      const score = Math.max(0, Math.min(10000, parseInt(body.score, 10) || 0));
      const scores = readScores();
      const prev = scores[id];
      if (!prev || score > prev.score) {
        scores[id] = { id: id, name: name, score: score };
        writeScores(scores);
      }
      return json(res, 200, { ok: true });
    });
  }

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
      'Cache-Control': ['.html', '.js', '.css'].indexOf(ext) >= 0 ? 'no-cache' : 'public, max-age=3600'
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
