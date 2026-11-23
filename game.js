/* ============================================================================
   DRAG TOWER — аркада «башня из вымышленных девайсов»
   Telegram Mini App, чистый JavaScript + Canvas 2D, без зависимостей.

   Визуальный стиль: мультяшная «межпространственная лаборатория»
   (сдержанная отсылка к мультсериальной эстетике):
   толстые чёрные контуры, плоская заливка, портальный зелёный,
   горчичный жёлтый, приглушённый сине-зелёный фон, портал-вихрь.

   Архитектура файла:
     1.  Хранилище (localStorage) и настройки
     2.  Интеграция с Telegram WebApp SDK
     3.  Звук (Web Audio API, синтез без mp3)
     4.  Лидерборд (локальный + опциональный общий бэкенд)
     5.  Канвас, размеры, безопасные зоны
     6.  Состояние игры
     7.  Отрисовка девайсов и фона
     8.  Игровая логика (спавн, установка, обрезка, промах)
     9.  Главный цикл (обновление + рендер)
     10. Ввод и UI-экраны

   Важно про «не-телепортацию» башни: высота этажа и стартовая ширина
   вычисляются ОДИН раз в начале партии и не меняются при ресайзе/повороте.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     0. НАСТРОЙКА ОБЩЕГО ЛИДЕРБОРДА
     --------------------------------------------------------------------------
     Пока пусто — рейтинг работает локально (на устройстве игрока).
     Когда поднимешь бэкенд (например, на BotHost), впиши сюда адрес,
     и игра начнёт слать результаты на сервер. Подробности в README.
     ========================================================================== */
  // Общий лидерборд включается автоматически на хостинге Bothost:
  // тот же домен + /api. На GitHub Pages API нет — останется локальный рейтинг.
  var LEADERBOARD_API = (function () {
    try {
      var h = window.location.hostname || '';
      if (/bothost\.(tech|ru)$/.test(h)) return window.location.origin + '/api';
    } catch (e) { /* ignore */ }
    return '';
  })();

  /* Username бота — нужен для реферальных ссылок (БЕЗ символа @).
     Это публичное имя, его можно держать в коде. Токен бота здесь
     быть НЕ должен никогда: game.js скачивает каждый игрок. */
  var BOT_USERNAME = 'ricktower_bot';

  /* Short name Mini App — то, что указал в BotFather при /newapp */
  var APP_SHORT_NAME = 'ricktower';

  /* Сколько кристаллов даётся за приглашённого друга.
     Значение дублируется на сервере — здесь оно только для показа. */
  var REF_BONUS = 50;

  /* ==========================================================================
     СКИНЫ ОГУРЧИКА РИКА
     --------------------------------------------------------------------------
     Каталог лежит в src/skins.js (window.DRAG_SKINS): id, название, цена, PNG.
     Здесь: покупка за кристаллы, выбор, сохранение и предзагрузка картинок.
     Скины покупаются один раз и остаются на устройстве (localStorage).
     ========================================================================== */

  var SKIN_CATALOG = (window.DRAG_SKINS && window.DRAG_SKINS.list) ? window.DRAG_SKINS.list : [];
  var SKIN_SPRITE = (window.DRAG_SKINS && window.DRAG_SKINS.sprite) ||
    { width: 768, height: 256, content: { x: 0, y: 0, w: 768, h: 256 } };
  var SKIN_KEY = (window.DRAG_SKINS && window.DRAG_SKINS.storageKey) || 'dragtower.skin';
  var OWNED_KEY = (window.DRAG_SKINS && window.DRAG_SKINS.ownedKey) || 'dragtower.owned';
  var SKINS_BY_ID = {};

  for (var si = 0; si < SKIN_CATALOG.length; si++) {
    SKINS_BY_ID[SKIN_CATALOG[si].id] = SKIN_CATALOG[si];
  }

  // Купленные скины. Классический открыт всегда и бесплатно.
  var ownedSkins = (function () {
    var list = loadJSON(OWNED_KEY, ['classic']);
    if (!Array.isArray(list)) list = [];
    var out = ['classic'];
    for (var i = 0; i < list.length; i++) {
      if (SKINS_BY_ID[list[i]] && out.indexOf(list[i]) < 0) out.push(list[i]);
    }
    return out;
  })();

  function isOwned(id) {
    return ownedSkins.indexOf(id) >= 0;
  }

  function readSkinId() {
    try {
      var v = window.localStorage.getItem(SKIN_KEY);
      if (v && SKINS_BY_ID[v] && isOwned(v)) return v;
    } catch (e) { /* localStorage недоступен — играем со стандартным скином */ }
    return 'classic';
  }

  var equippedSkinId = readSkinId();

  function activeSkin() {
    return SKINS_BY_ID[equippedSkinId] || SKIN_CATALOG[0] || null;
  }

  // Сохранение выбора: при следующем запуске скин применится автоматически
  function equipSkin(id) {
    if (!SKINS_BY_ID[id] || !isOwned(id)) return false;
    equippedSkinId = id;
    try { window.localStorage.setItem(SKIN_KEY, id); } catch (e) { /* ignore */ }
    return true;
  }

  // Покупка или выбор. Возвращает:
  //   'equipped' — скин уже был и надет,
  //   'bought'   — куплен и надет,
  //   'poor'     — не хватает кристаллов.
  function pickSkin(id) {
    var sk = SKINS_BY_ID[id];
    if (!sk) return 'none';

    if (isOwned(id)) {
      equipSkin(id);
      return 'equipped';
    }

    if (profile.gems < sk.price) return 'poor';

    profile.gems -= sk.price;
    save(STORE_KEYS.gems, profile.gems);
    ownedSkins.push(id);
    saveJSON(OWNED_KEY, ownedSkins);
    equipSkin(id);
    return 'bought';
  }

  // Предзагрузка PNG. Пока картинка не готова, рисуется кодовая версия
  // огурчика в тех же цветах — игра не ждёт загрузку и не мигает.
  function preloadSkinImages() {
    for (var i = 0; i < SKIN_CATALOG.length; i++) {
      var sk = SKIN_CATALOG[i];
      if (sk.image) continue;
      var img = new Image();
      img.decoding = 'async';
      img.src = sk.img;
      sk.image = img;
    }
  }

  /* ==========================================================================
     1. ХРАНИЛИЩЕ И НАСТРОЙКИ
     ========================================================================== */

  var STORE_KEYS = {
    best: 'dragtower.best',
    gems: 'dragtower.gems',
    sound: 'dragtower.sound',
    board: 'dragtower.board'
  };

  function loadNum(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      if (v === null) return fallback;
      var n = parseInt(v, 10);
      return isNaN(n) ? fallback : n;
    } catch (e) { return fallback; }
  }
  function loadBool(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      if (v === null) return fallback;
      return v === '1';
    } catch (e) { return fallback; }
  }
  function loadJSON(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
  }
  function saveJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  var settings = { sound: loadBool(STORE_KEYS.sound, true) };

  var profile = {
    best: loadNum(STORE_KEYS.best, 0),
    gems: loadNum(STORE_KEYS.gems, 0)
  };

  /* ==========================================================================
     2. TELEGRAM WEBAPP SDK
     ========================================================================== */

  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

  // Данные игрока из Telegram: нужны для подписи результата в лидерборде
  var tgUser = { id: 0, name: 'Игрок' };

  /* Реферальное состояние.
     invitedBy — ID пригласившего, прилетает в start_param по ссылке.
     count/earned — сколько друзей пришло и сколько за них начислено;
     реальные значения приходят с сервера, локально это только кэш для показа. */
  var referral = {
    invitedBy: 0,
    count: loadNum('dragtower.refCount', 0),
    earned: loadNum('dragtower.refEarned', 0),
    reported: false // отправляли ли уже «я пришёл по ссылке» на сервер
  };

  function initTelegram() {
    if (!tg) return; // обычный браузер — просто работаем дальше

    try {
      tg.ready();
      tg.expand();
      document.body.classList.add('tg');
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      if (tg.setHeaderColor) tg.setHeaderColor('#0e1519');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0e1519');

      applyThemeParams();

      // Имя игрока для лидерборда
      var u = tg.initDataUnsafe && tg.initDataUnsafe.user;
      if (u) {
        tgUser.id = u.id || 0;
        tgUser.name = u.username
          ? '@' + u.username
          : [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Игрок';
      }

      // Пришёл ли игрок по реферальной ссылке: ?startapp=ref_123456789
      var sp = tg.initDataUnsafe && tg.initDataUnsafe.start_param;
      if (sp && /^ref_\d+$/.test(sp)) {
        var inviter = parseInt(sp.slice(4), 10);
        // Сам себя пригласить нельзя — сервер проверит это ещё раз
        if (inviter && inviter !== tgUser.id) referral.invitedBy = inviter;
      }

      if (tg.onEvent) {
        tg.onEvent('viewportChanged', resizeCanvas);
        tg.onEvent('themeChanged', applyThemeParams);
      }
    } catch (e) { /* SDK может быть частично недоступен */ }
  }

  // Своя светлая палитра: цвета текста из темы Telegram НЕ применяем,
  // иначе в тёмной теме белый текст пропадает на белых панелях.
  function applyThemeParams() { /* намеренно пусто */ }

  function isColor(v) { return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v); }

  /* ==========================================================================
     3. ЗВУК — Web Audio API, всё синтезируется на лету
     ========================================================================== */

  var audioCtx = null;

  function ensureAudio() {
    if (!settings.sound) return null;
    try {
      if (!audioCtx) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }

  function tone(freq, duration, type, volume, slideTo, delay) {
    var ctx2 = ensureAudio();
    if (!ctx2) return;
    var t0 = ctx2.currentTime + (delay || 0);
    var osc = ctx2.createOscillator();
    var gain = ctx2.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain);
    gain.connect(ctx2.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function noiseBurst(duration, volume, filterFreq) {
    var ctx2 = ensureAudio();
    if (!ctx2) return;
    var frames = Math.floor(ctx2.sampleRate * duration);
    var buffer = ctx2.createBuffer(1, frames, ctx2.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    var src = ctx2.createBufferSource();
    src.buffer = buffer;

    var filter = ctx2.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 900;

    var gain = ctx2.createGain();
    gain.gain.value = volume;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx2.destination);
    src.start();
  }

  var SFX = {
    place: function () { tone(300, 0.09, 'square', 0.15, 170); },
    perfect: function () {
      // «портальный» восходящий аккорд
      tone(520, 0.12, 'triangle', 0.17);
      tone(780, 0.16, 'triangle', 0.14, null, 0.05);
      tone(1170, 0.22, 'sine', 0.11, null, 0.1);
    },
    cut: function () { noiseBurst(0.25, 0.17, 700); },
    over: function () {
      tone(280, 0.5, 'sawtooth', 0.17, 65);
      tone(140, 0.7, 'sine', 0.13, 42, 0.08);
    },
    ui: function () { tone(480, 0.06, 'sine', 0.11); }
  };

  /* ==========================================================================
     4. ЛИДЕРБОРД
     --------------------------------------------------------------------------
     Два режима:
       • LEADERBOARD_API пустой → локальный рейтинг в localStorage
         (все результаты с этого устройства, подписанные именем из Telegram);
       • LEADERBOARD_API задан → общий рейтинг: POST результата и GET топа.
     Любая сетевая ошибка не ломает игру: молча откатываемся на локальный.
     ========================================================================== */

  var leaderboard = {
    rows: loadJSON(STORE_KEYS.board, []), // [{id, name, score, date}]
    remote: false
  };

  // Записываем результат в локальный рейтинг (одна строка на игрока — лучший счёт)
  function recordLocalScore(score) {
    var rows = leaderboard.rows.slice();
    var key = tgUser.id || 'local';
    var found = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === key) { found = rows[i]; break; }
    }
    if (found) {
      if (score > found.score) { found.score = score; found.date = Date.now(); }
      found.name = tgUser.name; // имя могло поменяться
    } else {
      rows.push({ id: key, name: tgUser.name, score: score, date: Date.now() });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    rows = rows.slice(0, 50);
    leaderboard.rows = rows;
    saveJSON(STORE_KEYS.board, rows);
  }

  // Отправка результата на общий сервер (если он настроен)
  function submitRemoteScore(score) {
    if (!LEADERBOARD_API) return;
    try {
      fetch(LEADERBOARD_API + '/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // initData нужен серверу, чтобы проверить подпись Telegram
          initData: tg ? tg.initData : '',
          score: score
        })
      })['catch'](function () { /* сеть недоступна — не мешаем игре */ });
    } catch (e) { /* ignore */ }
  }

  // Загрузка общего топа; возвращает промис со списком строк
  function fetchRemoteBoard() {
    if (!LEADERBOARD_API) return Promise.resolve(null);
    return fetch(LEADERBOARD_API + '/top?limit=20')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return null;
        var list = Array.isArray(data) ? data : data.top;
        return Array.isArray(list) ? list : null;
      })
      ['catch'](function () { return null; });
  }

  /* ==========================================================================
     4.5. РЕФЕРАЛЬНАЯ СИСТЕМА
     --------------------------------------------------------------------------
     Как работает:
       1. Игрок делится ссылкой вида
          https://t.me/<бот>/<app>?startapp=ref_<его_id>
       2. Друг открывает игру — Telegram кладёт 'ref_<id>' в start_param.
       3. После ПЕРВОЙ сыгранной партии игра шлёт на сервер initData + ref.
       4. Сервер проверяет подпись, что игрок новый и что ref ≠ сам игрок,
          и начисляет бонус пригласившему.

     Почему проверки на сервере: всё, что решает браузер, подделывается
     через консоль за секунду. Клиент только сообщает факт, решает сервер.
     Без LEADERBOARD_API рефералка не работает — показываем это честно.
     ========================================================================== */

  // Ссылка-приглашение с ID игрока внутри
  function buildInviteLink() {
    var id = tgUser.id || 0;
    return 'https://t.me/' + BOT_USERNAME + '/' + APP_SHORT_NAME +
           (id ? '?startapp=ref_' + id : '');
  }

  // Сообщаем серверу, что пришли по ссылке (один раз за сессию)
  function reportReferral() {
    if (!LEADERBOARD_API || !referral.invitedBy || referral.reported) return;
    referral.reported = true;
    try {
      fetch(LEADERBOARD_API + '/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: tg ? tg.initData : '',
          ref: referral.invitedBy
        })
      })['catch'](function () { /* сеть недоступна — не мешаем игре */ });
    } catch (e) { /* ignore */ }
  }

  // Забираем с сервера актуальную статистику приглашений
  function fetchReferralStats() {
    if (!LEADERBOARD_API || !tg) return Promise.resolve(null);
    return fetch(LEADERBOARD_API + '/referrals?initData=' +
                 encodeURIComponent(tg.initData))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return null;
        // Сервер — единственный источник правды по кристаллам за рефералов
        referral.count = parseInt(data.count, 10) || 0;
        referral.earned = parseInt(data.earned, 10) || 0;
        save('dragtower.refCount', referral.count);
        save('dragtower.refEarned', referral.earned);
        if (typeof data.gems === 'number') {
          profile.gems = data.gems;
          save(STORE_KEYS.gems, profile.gems);
        }
        return data;
      })
      ['catch'](function () { return null; });
  }

  // Делимся ссылкой через нативный диалог Telegram
  function inviteFriend() {
    var link = buildInviteLink();
    var text = 'Собери башню из огурчиков 🥒 Жду тебя в RICK TOWER!';

    if (tg && tg.openTelegramLink) {
      // share/url открывает выбор чата прямо внутри Telegram
      tg.openTelegramLink('https://t.me/share/url?url=' +
        encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
    } else {
      copyInviteLink(); // в браузере просто копируем
    }
  }

  // Копирование ссылки в буфер обмена с запасным вариантом для старых WebView
  function copyInviteLink() {
    var link = buildInviteLink();
    var done = function () { showToast('Ссылка скопирована'); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done)['catch'](function () {
        legacyCopy(link, done);
      });
    } else {
      legacyCopy(link, done);
    }
  }

  function legacyCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {
      showToast('Не удалось скопировать');
    }
  }

  /* ==========================================================================
     5. КАНВАС И РАЗМЕРЫ
     ========================================================================== */

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var VIEW = { w: 360, h: 640, dpr: 1, safeTop: 0, safeBottom: 0 };

  function readSafeInset(name) {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;' +
      'padding-' + name + ':env(safe-area-inset-' + name + ',0px);visibility:hidden;';
    document.body.appendChild(probe);
    var v = parseFloat(getComputedStyle(probe)['padding' + name.charAt(0).toUpperCase() + name.slice(1)]) || 0;
    document.body.removeChild(probe);
    return v;
  }

  function resizeCanvas() {
    var w = window.innerWidth;
    var h = window.innerHeight;

    if (tg && tg.viewportStableHeight && tg.viewportStableHeight > 100) {
      h = Math.min(h, tg.viewportStableHeight);
    }

    VIEW.w = w;
    VIEW.h = h;
    VIEW.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    VIEW.safeTop = readSafeInset('top');
    VIEW.safeBottom = readSafeInset('bottom');

    canvas.width = Math.round(w * VIEW.dpr);
    canvas.height = Math.round(h * VIEW.dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);

    clampMovingBlock();
  }

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () {
    setTimeout(resizeCanvas, 120); // iOS сообщает размеры с задержкой
  });

  /* ==========================================================================
     6. СОСТОЯНИЕ ИГРЫ
     ========================================================================== */

  var STATE = { MENU: 'menu', PLAY: 'play', OVER: 'over', BOARD: 'board', FRIENDS: 'friends', SKINS: 'skins' };
  var PHASE = { MOVING: 'moving', DROPPING: 'dropping', FALLING_OUT: 'fallingOut' };

  var game = {
    state: STATE.MENU,
    phase: PHASE.MOVING,

    blockH: 46,
    startW: 240,
    groundY: 90,

    tower: [],
    moving: null,
    debris: [],
    particles: [],
    popups: [],

    camera: 0,
    cameraTarget: 0,
    shake: 0,

    score: 0,
    gems: 0,
    streak: 0,
    bestStreak: 0,
    nextWidth: 240,
    dir: 1,
    newBest: false,

    overAt: 0,
    clouds: []
  };

  var PERFECT_TOL = 7;
  var WIDTH_BONUS = 16;
  var GRAVITY = 3600;

  /* --- Палитра вымышленных девайсов ---
     Приглушённая мультяшная гамма: грязноватые насыщенные цвета,
     каждый корпус обводится чёрным «чернильным» контуром. --- */
  var INK = '#17303f';

  /* Оттенки огурчиков: от молодого корнишона до перекисшего в рассоле */
  var BRINE = '#c9d98a';   // цвет рассола в капельках

  /* Выражения лица — чтобы в башне не было двух одинаковых огурчиков:
       'smug'    — ухмылка и прищур,
       'shock'   — круглые глаза, открытый рот,
       'grin'    — широкая улыбка до ушей,
       'squint'  — хитрый прищур,
       'worried' — скошенные брови, волнистый рот. */
  var FACES = ['smug', 'shock', 'grin', 'squint', 'worried'];

  function makeStyle(index) {
    // Палитра — запасной вариант, пока PNG скина не загрузился
    var sk = activeSkin();
    var p = (sk && sk.palette) || { body: '#8fc63d', body2: '#4a7016', accent: '#d9f08a', led: '#f4ffd6' };

    return {
      skin: sk,
      body: p.body,
      body2: p.body2,
      accent: p.accent,
      led: p.led,
      face: FACES[Math.floor(Math.random() * FACES.length)],
      tilt: (Math.random() - 0.5) * 0.1,
      hasStem: Math.random() < 0.55,
      hasDrip: Math.random() < 0.4,
      phase: Math.random() * Math.PI * 2,
      seed: index * 37 + Math.floor(Math.random() * 1000)
    };
  }

  /* ==========================================================================
     7. ОТРИСОВКА
     ========================================================================== */

  function worldToScreenY(worldY) {
    return VIEW.h - game.groundY - worldY + game.camera;
  }

  function roundRect(c, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  /* PNG-скин вписывается в тот же прямоугольник, что и процедурный огурчик.
     Прозрачные поля спрайта (8px) отрезаются через source-rect, поэтому
     видимый край совпадает с областью столкновения: предмет не «висит»
     над башней и не проваливается в неё. */
  function drawSkinSprite(x, y, w, h, style, opts, skin) {
    var c = ctx;
    var sp = SKIN_SPRITE.content;
    var img = skin.image;

    c.save();
    var cx = x + w / 2;
    var cy = y + h / 2;
    c.translate(cx, cy);
    c.rotate(style.tilt * 0.7);
    c.translate(-cx, -cy);

    // Портальный след под летящим огурчиком
    if (opts.beam) {
      c.save();
      c.strokeStyle = '#7fb84a';
      c.lineWidth = 2;
      for (var bi = 1; bi <= 3; bi++) {
        c.globalAlpha = 0.28 / bi;
        c.beginPath();
        c.ellipse(cx, y + h + 5 + bi * 5, w * 0.26 * bi * 0.7, 3 * bi, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    }

    if (opts.glow) {
      c.shadowColor = 'rgba(92, 156, 62, 0.55)';
      c.shadowBlur = opts.glow;
    }
    // Тело спрайта (content) вписывается в блок ровно, без прозрачных полей:
    // поэтому соседние огурчики соприкасаются. Аксессуары выходят за блок.
    var sx = w / sp.w;
    var sy = h / sp.h;
    var dx = x - sp.x * sx;
    var dy = y - sp.y * sy;
    var dw = SKIN_SPRITE.width * sx;
    var dh = SKIN_SPRITE.height * sy;

    c.imageSmoothingEnabled = true;
    c.drawImage(img, 0, 0, SKIN_SPRITE.width, SKIN_SPRITE.height, dx, dy, dw, dh);
    c.restore();
  }

  /**
   * Рисует огурчик с лицом — элемент башни.
   * Корпус: скруглённый цилиндр с пупырышками и продольными бликами,
   * сверху хвостик от плодоножки, сбоку капелька рассола.
   * Лицо: глаза с бликами, брови и рот — выражение зависит от style.face.
   *
   * opts.glow — сила свечения (у летящего огурчика сильнее),
   * opts.beam — рисовать портальный след снизу.
   */
  function drawDevice(x, y, w, h, style, opts) {
    opts = opts || {};
    if (w < 1 || h < 1) return;

    // Если PNG скина загружен — рисуем его, иначе кодовый огурчик ниже
    var skin = style.skin || activeSkin();
    if (skin && skin.image && skin.image.complete && skin.image.naturalWidth > 0) {
      drawSkinSprite(x, y, w, h, style, opts, skin);
      return;
    }

    var c = ctx;
    c.save();

    var ink = Math.max(1.5, Math.min(3.5, w * 0.05));
    var t = performance.now() * 0.003 + style.phase;

    var cx = x + w / 2;
    var cy = y + h / 2;

    // Лёгкий наклон вокруг центра — огурчики лежат чуть небрежно
    c.translate(cx, cy);
    c.rotate(style.tilt);
    c.translate(-cx, -cy);

    // --- Портальный след под летящим огурчиком ---
    if (opts.beam) {
      c.save();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#7fb84a';
      c.lineWidth = 2;
      // Три расходящихся дуги — компактный портальный намёк
      for (var bi = 1; bi <= 3; bi++) {
        c.globalAlpha = 0.3 / bi;
        c.beginPath();
        c.ellipse(cx, y + h + 6 + bi * 5, w * 0.26 * bi * 0.7, 3 * bi, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    }

    // --- Хвостик от плодоножки ---
    if (style.hasStem && h > 26) {
      var stemH = Math.min(h * 0.16, 9);
      c.beginPath();
      c.moveTo(cx, y + 2);
      c.quadraticCurveTo(cx + w * 0.05, y - stemH * 0.6, cx - w * 0.03, y - stemH);
      c.strokeStyle = '#5e7a22';
      c.lineWidth = Math.max(2, ink * 1.1);
      c.lineCap = 'round';
      c.stroke();
    }

    // --- Корпус: вытянутый овал с сужающимися концами ---
    // Рисуем вручную, чтобы концы были уже середины, как у настоящего огурца.
    var midY = y + h / 2;
    var taper = Math.min(h * 0.28, w * 0.18);  // насколько поджаты концы
    var bulge = h * 0.04;                       // лёгкая пузатость середины

    function bodyOutline(inset) {
      var xx = x + inset, ww = w - inset * 2;
      var yy = y + inset, hh = h - inset * 2;
      var my = yy + hh / 2;
      var tp = Math.min(taper, ww * 0.3);
      c.beginPath();
      c.moveTo(xx + tp, yy);
      c.bezierCurveTo(xx + ww * 0.35, yy - bulge, xx + ww * 0.65, yy - bulge, xx + ww - tp, yy);
      c.bezierCurveTo(xx + ww - tp * 0.25, yy, xx + ww, my - hh * 0.3, xx + ww, my);
      c.bezierCurveTo(xx + ww, my + hh * 0.3, xx + ww - tp * 0.25, yy + hh, xx + ww - tp, yy + hh);
      c.bezierCurveTo(xx + ww * 0.65, yy + hh + bulge, xx + ww * 0.35, yy + hh + bulge, xx + tp, yy + hh);
      c.bezierCurveTo(xx + tp * 0.25, yy + hh, xx, my + hh * 0.3, xx, my);
      c.bezierCurveTo(xx, my - hh * 0.3, xx + tp * 0.25, yy, xx + tp, yy);
      c.closePath();
    }

    bodyOutline(0);

    if (opts.glow) {
      c.shadowColor = style.body;
      c.shadowBlur = opts.glow;
    }
    var grad = c.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, style.accent);
    grad.addColorStop(0.3, style.body);
    grad.addColorStop(1, style.body2);
    c.fillStyle = grad;
    c.fill();
    c.shadowBlur = 0;

    // Декор обрезаем по форме огурчика
    c.save();
    bodyOutline(0);
    c.clip();

    // Продольные светлые полосы — характерная «дольчатость» огурца
    c.globalAlpha = 0.16;
    c.fillStyle = '#ffffff';
    c.fillRect(x, y + h * 0.24, w, Math.max(1.5, h * 0.045));
    c.fillRect(x, y + h * 0.66, w, Math.max(1.2, h * 0.035));
    c.globalAlpha = 1;

    // Пупырышки: мелкие бугорки со светлой фаской и тенью
    var bumpStep = Math.max(14, w / 8);
    for (var bx = x + bumpStep * 0.7; bx < x + w - 6; bx += bumpStep) {
      for (var row = 0; row < 2; row++) {
        var by = midY + (row === 0 ? -h * 0.22 : h * 0.2) + ((bx / bumpStep) % 2) * h * 0.07;
        var br = Math.max(1.1, Math.min(w * 0.014, 2.3));
        c.globalAlpha = 0.28;
        c.fillStyle = '#28400c';
        c.beginPath();
        c.arc(bx, by + br * 0.5, br, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 0.4;
        c.fillStyle = '#eaffc0';
        c.beginPath();
        c.arc(bx, by - br * 0.3, br * 0.8, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    // Верхний блик вдоль корпуса
    var gloss = c.createLinearGradient(0, y, 0, y + h * 0.5);
    gloss.addColorStop(0, 'rgba(255,255,255,0.32)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gloss;
    roundRect(c, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.26, h * 0.13);
    c.fill();

    c.restore(); // снимаем clip

    // --- Контур ---
    bodyOutline(ink / 2);
    c.strokeStyle = INK;
    c.lineWidth = ink;
    c.lineJoin = 'round';
    c.stroke();

    // --- Лицо: смещено к одному из концов, как у персонажа-огурца ---
    drawFace(c, cx, midY, w, h, style, ink, t);

    // --- Капелька рассола, слегка покачивается ---
    if (style.hasDrip && h > 28) {
      var dx = x + w * 0.82;
      var dy = y + h - 1 + Math.sin(t * 0.6) * 1.5;
      var dr = Math.max(2, Math.min(h * 0.09, 4));
      c.beginPath();
      c.moveTo(dx, dy - dr);
      c.quadraticCurveTo(dx + dr, dy + dr * 0.4, dx, dy + dr);
      c.quadraticCurveTo(dx - dr, dy + dr * 0.4, dx, dy - dr);
      c.closePath();
      c.fillStyle = BRINE;
      c.globalAlpha = 0.8;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = INK;
      c.lineWidth = ink * 0.5;
      c.stroke();
    }

    c.restore();
  }

  /* Лицо огурчика: глаза, брови и рот. Выражение задаётся style.face. */
  /* Лицо: выпуклые глаза-шары, зубастый рот, одинокая бровь.
     Пропорции взяты с референса — глаза крупные и близко посажены,
     рот широкий и открытый, с видимым рядом зубов. */
  function drawFace(c, cx, cy, w, h, style, ink, t) {
    if (w < 30 || h < 16) return; // на мелких обрезках лицо не помещается

    var eyeR = Math.max(3, Math.min(h * 0.2, w * 0.075, 11));
    var gap = eyeR * 1.05;              // глаза почти вплотную
    var eyeY = cy - h * 0.14;
    var face = style.face;

    // Моргание
    var blink = Math.sin(t * 0.35 + style.phase) > 0.985;

    // --- Бровь: одна тонкая дуга над глазами ---
    c.strokeStyle = '#9fb8c4';
    c.lineWidth = Math.max(1.6, eyeR * 0.3);
    c.lineCap = 'round';
    c.beginPath();
    var browY = eyeY - eyeR * 1.35;
    if (face === 'worried') {
      c.moveTo(cx - gap - eyeR * 0.8, browY + eyeR * 0.3);
      c.quadraticCurveTo(cx, browY - eyeR * 0.5, cx + gap + eyeR * 0.8, browY + eyeR * 0.5);
    } else {
      c.moveTo(cx - gap - eyeR * 0.9, browY + eyeR * 0.2);
      c.quadraticCurveTo(cx, browY - eyeR * 0.65, cx + gap + eyeR * 0.9, browY + eyeR * 0.1);
    }
    c.stroke();

    // --- Глаза: выпуклые белые шары с тенью у основания ---
    [-1, 1].forEach(function (s) {
      var ex = cx + s * gap;

      // тень под глазом — создаёт ощущение, что он выступает из тела
      c.beginPath();
      c.ellipse(ex, eyeY + eyeR * 0.3, eyeR * 1.05, eyeR * 0.9, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(40, 64, 12, 0.5)';
      c.fill();

      if (blink) {
        c.strokeStyle = INK;
        c.lineWidth = Math.max(1.5, ink * 0.6);
        c.beginPath();
        c.arc(ex, eyeY, eyeR * 0.8, Math.PI * 0.15, Math.PI * 0.85);
        c.stroke();
        return;
      }

      var squint = (face === 'squint' || face === 'smug') ? 0.78 : 1;
      var big = face === 'shock' ? 1.15 : 1;
      drawEye(c, ex, eyeY, eyeR * big, ink, squint);
    });

    // --- Рот ---
    var mouthY = cy + h * 0.2;
    var mw = Math.max(5, Math.min(w * 0.1, h * 0.26, 18));
    var mh = mw * (face === 'shock' ? 0.85 : 0.62);

    if (face === 'worried') {
      // Сжатая волнистая линия
      c.strokeStyle = INK;
      c.lineWidth = Math.max(1.8, ink * 0.85);
      c.beginPath();
      c.moveTo(cx - mw, mouthY);
      c.quadraticCurveTo(cx - mw * 0.5, mouthY - mw * 0.3, cx, mouthY);
      c.quadraticCurveTo(cx + mw * 0.5, mouthY + mw * 0.3, cx + mw, mouthY);
      c.stroke();
      return;
    }

    // Открытый рот: тёмная полость с рядом зубов сверху
    c.save();
    c.beginPath();
    if (face === 'grin') {
      // Широкий оскал — полуэллипс вниз
      c.ellipse(cx, mouthY - mh * 0.15, mw, mh, 0, 0, Math.PI);
    } else if (face === 'shock') {
      c.ellipse(cx, mouthY, mw * 0.8, mh, 0, 0, Math.PI * 2);
    } else {
      // Асимметричный кривой рот
      c.ellipse(cx, mouthY - mh * 0.1, mw, mh * 0.9, 0.12, 0, Math.PI * 2);
    }
    c.closePath();
    c.fillStyle = '#3d1620';
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = Math.max(1.5, ink * 0.7);
    c.stroke();

    // Зубы: белая полоса с вертикальными разделителями
    if (mw > 7) {
      c.clip();
      var toothH = Math.max(2, mh * 0.42);
      var toothY = mouthY - mh * (face === 'shock' ? 0.85 : 0.95);
      c.fillStyle = '#f2f4ea';
      c.fillRect(cx - mw, toothY, mw * 2, toothH);
      c.strokeStyle = 'rgba(60,40,40,0.5)';
      c.lineWidth = 1;
      for (var tx = cx - mw + mw * 0.4; tx < cx + mw; tx += mw * 0.4) {
        c.beginPath();
        c.moveTo(tx, toothY);
        c.lineTo(tx, toothY + toothH);
        c.stroke();
      }
    }
    c.restore();
  }
  /* Мультяшный глаз: белок, зрачок, блик.
     squint < 1 сплющивает глаз по вертикали — получается прищур. */
  function drawEye(c, cx, cy, r, ink, squint) {
    var sq = squint == null ? 1 : squint;

    c.beginPath();
    c.ellipse(cx, cy, r, r * sq, 0, 0, Math.PI * 2);
    c.fillStyle = '#f6f8f2';
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = ink * 0.6;
    c.stroke();

    // Зрачок смещён к центру лица — взгляд «в кадр»
    c.beginPath();
    c.arc(cx + r * 0.12, cy + r * sq * 0.12, r * 0.4 * Math.max(sq, 0.7), 0, Math.PI * 2);
    c.fillStyle = INK;
    c.fill();

    c.beginPath();
    c.arc(cx - r * 0.25, cy - r * sq * 0.3, r * 0.17, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
  }



  /* Мягкая контактная тень внизу блока: башня читается плотнее,
     а стык между огурчиками не выглядит «плоской склейкой». */
  function drawBlockContact(x, y, w, h, index) {
    var c = ctx;
    var g = c.createLinearGradient(0, y + h * 0.8, 0, y + h);
    g.addColorStop(0, 'rgba(26, 48, 26, 0)');
    g.addColorStop(1, 'rgba(26, 48, 26, 0.28)');
    c.save();
    c.fillStyle = g;
    c.fillRect(x + w * 0.14, y + h * 0.8, w * 0.72, h * 0.2);
    if (index > 0) {
      c.globalAlpha = 0.18;
      c.fillStyle = '#ffffff';
      c.fillRect(x + w * 0.2, y + 1, w * 0.6, 2);
    }
    c.restore();
  }

  function initClouds() {
    game.clouds = [];
    for (var i = 0; i < 10; i++) {
      game.clouds.push({
        x: Math.random(),
        y: 0.02 + Math.random() * 0.58,
        s: 0.55 + Math.random() * 0.75,
        depth: 0.2 + Math.random() * 0.6,
        drift: 0.004 + Math.random() * 0.012,
        alpha: 0.55 + Math.random() * 0.35
      });
    }
  }

  /* Одно облако: несколько кругов и плоское основание.
     Без картинок — значит, не мылится на любом DPR. */
  function drawCloud(x, y, s, alpha) {
    var c = ctx;
    var puffs = [[-34, 8, 21], [-12, -6, 27], [14, -10, 30], [38, 6, 21], [0, 14, 26]];
    c.save();
    c.globalAlpha = alpha;

    // мягкая голубая тень-подложка: облако читается даже на бледном небе
    c.fillStyle = '#cfe8f7';
    for (var s0 = 0; s0 < puffs.length; s0++) {
      c.beginPath();
      c.arc(x + puffs[s0][0] * s, y + (puffs[s0][1] + 5) * s, puffs[s0][2] * s, 0, Math.PI * 2);
      c.fill();
    }
    roundRect(c, x - 56 * s, y + 9 * s, 112 * s, 28 * s, 14 * s);
    c.fill();

    c.fillStyle = '#ffffff';
    for (var i = 0; i < puffs.length; i++) {
      c.beginPath();
      c.arc(x + puffs[i][0] * s, y + puffs[i][1] * s, puffs[i][2] * s, 0, Math.PI * 2);
      c.fill();
    }
    roundRect(c, x - 56 * s, y + 6 * s, 112 * s, 26 * s, 13 * s);
    c.fill();

    // голубоватая тень снизу — облако не выглядит плоской наклейкой
    c.globalAlpha = alpha * 0.35;
    c.fillStyle = '#c9e6f6';
    c.beginPath();
    c.ellipse(x + 2 * s, y + 28 * s, 48 * s, 9 * s, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /* Солнечные лучи — мягкие, почти прозрачные */
  function drawSunRays(sx, sy, time) {
    var c = ctx;
    var len = Math.max(VIEW.w, VIEW.h) * 1.1;
    c.save();
    c.fillStyle = '#fff3b8';
    c.globalAlpha = 0.16;
    for (var i = 0; i < 5; i++) {
      var a = -1.0 + i * 0.33 + Math.sin(time * 0.0002 + i) * 0.012;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + Math.cos(a - 0.055) * len, sy + Math.sin(a - 0.055) * len);
      c.lineTo(sx + Math.cos(a + 0.055) * len, sy + Math.sin(a + 0.055) * len);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  /* Птицы: три силуэта, машут крыльями и медленно летят */
  function drawBirds(time) {
    var c = ctx;
    c.save();
    c.strokeStyle = 'rgba(58, 88, 104, 0.55)';
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var bx = ((i * 0.33 + 0.1) * VIEW.w + time * 0.007 * (i + 1)) % (VIEW.w + 100) - 50;
      var by = VIEW.h * (0.2 + i * 0.06) + Math.sin(time * 0.001 + i) * 6 + game.camera * 0.04;
      var s = 7 + i * 2;
      var flap = Math.sin(time * 0.005 + i * 1.7) * 0.7;
      c.beginPath();
      c.moveTo(bx - s, by + s * 0.4 * flap);
      c.quadraticCurveTo(bx - s * 0.35, by - s * 0.35, bx, by);
      c.quadraticCurveTo(bx + s * 0.35, by - s * 0.35, bx + s, by + s * 0.4 * flap);
      c.stroke();
    }
    c.restore();
  }

  /* Пыльца/споры: мелкие точки, медленно поднимаются вверх */
  function drawSpores(time) {
    var c = ctx;
    c.save();
    c.fillStyle = '#ffffff';
    for (var i = 0; i < 14; i++) {
      var x = ((i * 73) % 100) / 100 * VIEW.w + Math.sin(time * 0.0007 + i) * 16;
      var span = VIEW.h + 60;
      var y = (((i * 137) % 100) / 100 * span - time * 0.012 * (1 + i % 3)) % span;
      if (y < 0) y += span;
      var r = 1.3 + (i % 3) * 0.7;
      c.globalAlpha = 0.3 + 0.25 * Math.sin(time * 0.002 + i);
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
  }

  function drawBackground(time) {
    var c = ctx;

    // Светлое небо: бледно-голубое сверху, тёплое у горизонта
    var g = c.createLinearGradient(0, 0, 0, VIEW.h);
    g.addColorStop(0, '#b4ddf7');
    g.addColorStop(0.42, '#d9f0fd');
    g.addColorStop(0.76, '#f5feff');
    g.addColorStop(1, '#e4f4dd');
    c.fillStyle = g;
    c.fillRect(0, 0, VIEW.w, VIEW.h);

    // Солнце с мягким ореолом
    var sx = VIEW.w * 0.82;
    var sy = VIEW.h * 0.13 + game.camera * 0.02;
    var sr = Math.min(VIEW.w, VIEW.h) * 0.07;
    var sun = c.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
    sun.addColorStop(0, 'rgba(255, 249, 214, 0.95)');
    sun.addColorStop(0.35, 'rgba(255, 249, 214, 0.45)');
    sun.addColorStop(1, 'rgba(255, 249, 214, 0)');
    c.fillStyle = sun;
    c.beginPath();
    c.arc(sx, sy, sr * 3.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff8c9';
    c.beginPath();
    c.arc(sx, sy, sr, 0, Math.PI * 2);
    c.fill();

    drawSunRays(sx, sy, time);

    // Облака плывут медленно и слегка смещаются от камеры
    var span = VIEW.w + 260;
    for (var i = 0; i < game.clouds.length; i++) {
      var cl = game.clouds[i];
      var cx2 = ((cl.x * span + time * cl.drift) % span) - 130;
      var cy2 = cl.y * VIEW.h + game.camera * cl.depth * 0.22;
      cy2 = cy2 % (VIEW.h + 200);
      if (cy2 < -120) cy2 += VIEW.h + 200;
      drawCloud(cx2, cy2, cl.s, cl.alpha);
    }

    drawBirds(time);
    drawSpores(time);

    drawHills();
  }

  /* Холмы у горизонта: два светлых слоя, без ночного города и неона */
  function drawHills() {
    var c = ctx;
    var baseY = VIEW.h - game.groundY + game.camera;
    if (baseY < -160 || baseY > VIEW.h + 320) return;

    c.save();
    c.fillStyle = 'rgba(158, 203, 160, 0.85)';
    c.beginPath();
    c.moveTo(0, baseY + 40);
    c.quadraticCurveTo(VIEW.w * 0.2, baseY - 50, VIEW.w * 0.42, baseY + 10);
    c.quadraticCurveTo(VIEW.w * 0.62, baseY - 70, VIEW.w * 0.85, baseY + 5);
    c.quadraticCurveTo(VIEW.w * 0.95, baseY - 20, VIEW.w, baseY + 25);
    c.lineTo(VIEW.w, baseY + 220);
    c.lineTo(0, baseY + 220);
    c.closePath();
    c.fill();

    c.fillStyle = 'rgba(122, 182, 132, 0.9)';
    c.beginPath();
    c.moveTo(0, baseY + 62);
    c.quadraticCurveTo(VIEW.w * 0.3, baseY - 8, VIEW.w * 0.55, baseY + 48);
    c.quadraticCurveTo(VIEW.w * 0.8, baseY - 2, VIEW.w, baseY + 52);
    c.lineTo(VIEW.w, baseY + 220);
    c.lineTo(0, baseY + 220);
    c.closePath();
    c.fill();

    // травинки на ближнем холме
    c.strokeStyle = 'rgba(96, 152, 92, 0.7)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    for (var g = 0; g < 14; g++) {
      var gx = (g + 0.5) / 14 * VIEW.w;
      var gy = baseY + 26 + (g % 3) * 7;
      var gh = 5 + (g % 4) * 2;
      c.beginPath();
      c.moveTo(gx, gy);
      c.quadraticCurveTo(gx + 2, gy - gh, gx + 4, gy - gh * 0.6);
      c.moveTo(gx, gy);
      c.quadraticCurveTo(gx - 2, gy - gh * 0.8, gx - 4, gy - gh * 0.5);
      c.stroke();
    }
    c.restore();
  }

  // Пол/пьедестал под первым девайсом
  function drawGround() {
    var c = ctx;
    var y = worldToScreenY(0);
    if (y < -60 || y > VIEW.h + 60) return;

    var padW = Math.min(VIEW.w * 0.94, game.startW * 1.6);
    var padX = (VIEW.w - padW) / 2;

    c.save();
    var g = c.createLinearGradient(0, y, 0, y + 44);
    g.addColorStop(0, '#f7e8bf');
    g.addColorStop(1, '#d2b682');
    roundRect(c, padX, y, padW, 44, 10);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.stroke();

    // Зелёная кромка платформы
    c.strokeStyle = 'rgba(108, 175, 72, 0.9)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(padX + 12, y + 5);
    c.lineTo(padX + padW - 12, y + 5);
    c.stroke();
    c.restore();
  }

  /* ==========================================================================
     8. ИГРОВАЯ ЛОГИКА
     ========================================================================== */

  function currentSpeed() {
    var scale = Math.max(0.75, Math.min(VIEW.w / 390, 1.6));
    var base = 165 + game.score * 9;
    return Math.min(base, 540) * scale;
  }

  function topBlock() { return game.tower[game.tower.length - 1]; }

  function towerTopWorld() { return game.tower.length * game.blockH; }

  function spawnMoving() {
    var w = Math.max(14, game.nextWidth);
    var base = towerTopWorld();
    var hover = game.blockH * 2.4;

    // Направление чередуется: чётный этаж — слева направо, нечётный — наоборот
    game.dir = (game.tower.length % 2 === 0) ? 1 : -1;

    var maxX = Math.max(0, VIEW.w - w);

    game.moving = {
      x: game.dir > 0 ? 0 : maxX,
      w: w,
      base: base,
      y: base + hover,
      targetY: base,
      vy: 0,
      style: makeStyle(game.tower.length)
    };
    game.phase = PHASE.MOVING;
  }

  function clampMovingBlock() {
    if (!game.moving) return;
    var maxX = Math.max(0, VIEW.w - game.moving.w);
    if (game.moving.x > maxX) game.moving.x = maxX;
    if (game.moving.x < 0) game.moving.x = 0;
  }

  function startGame() {
    // Размеры фиксируем один раз на партию — башня не «прыгает» при повороте.
    // Блок сделан выше и уже обычного: иначе девайс с картриджем не читается.
    game.blockH = Math.max(42, Math.min(VIEW.h * 0.075, 62));
    game.startW = Math.max(120, Math.min(VIEW.w * 0.5, 212));
    game.groundY = Math.max(80, VIEW.h * 0.16 + VIEW.safeBottom);

    game.tower = [];
    game.debris = [];
    game.particles = [];
    game.popups = [];
    game.score = 0;
    game.gems = 0;
    game.streak = 0;
    game.bestStreak = 0;
    game.newBest = false;
    game.nextWidth = game.startW;
    game.camera = 0;
    game.cameraTarget = 0;
    game.shake = 0;

    game.tower.push({
      x: (VIEW.w - game.startW) / 2,
      w: game.startW,
      base: 0,
      style: makeStyle(0)
    });

    spawnMoving();
    game.state = STATE.PLAY;
    updateHud();
    showScreen(null);
    el.hud.classList.remove('hidden');
    el.tapHint.classList.remove('hidden');
    setTimeout(function () { el.tapHint.classList.add('hidden'); }, 2600);
  }

  /**
   * Главное действие игрока: «уронить» девайс.
   * Вся игровая логика (очки, обрезка, промах) решается ЗДЕСЬ, в момент тапа.
   * Дальше идёт только анимация — поэтому очки за промах начислить невозможно.
   */
  function dropBlock() {
    if (game.state !== STATE.PLAY || game.phase !== PHASE.MOVING || !game.moving) return;

    var prev = topBlock();
    var cur = game.moving;

    var overlapLeft = Math.max(prev.x, cur.x);
    var overlapRight = Math.min(prev.x + prev.w, cur.x + cur.w);
    var overlap = overlapRight - overlapLeft;
    var delta = cur.x - prev.x;

    // ---- ПРОМАХ: пересечения нет ----
    if (overlap <= 0) {
      game.phase = PHASE.FALLING_OUT;
      game.debris.push({
        x: cur.x, w: cur.w, h: game.blockH,
        y: cur.y, vy: -60, vx: (delta > 0 ? 120 : -120),
        rot: 0, vrot: (delta > 0 ? 3 : -3),
        style: cur.style, life: 2.2
      });
      game.moving = null;
      game.streak = 0;
      game.shake = 14;
      SFX.over();
      game.overAt = performance.now();
      updateHud();
      return;
    }

    // ---- ИДЕАЛЬНОЕ ПОПАДАНИЕ ----
    var isPerfect = Math.abs(delta) <= PERFECT_TOL;
    var placedX, placedW;

    if (isPerfect) {
      placedX = prev.x;
      placedW = prev.w;
      game.streak++;
      if (game.streak > game.bestStreak) game.bestStreak = game.streak;
      game.gems += 2;

      var bonus = 0;
      if (game.streak % 3 === 0) {
        bonus = WIDTH_BONUS;
        spawnPopup('ШИРЕ! +' + WIDTH_BONUS, '#c9861e', 0.35);
      }
      game.nextWidth = Math.min(game.startW, placedW + bonus);

      spawnPopup('ИДЕАЛЬНО!', '#4c9a2a', 0);
      spawnPerfectParticles(placedX + placedW / 2, worldToScreenY(cur.base + game.blockH));
      SFX.perfect();
    } else {
      // ---- ОБЫЧНАЯ УСТАНОВКА С ОБРЕЗКОЙ ----
      placedX = overlapLeft;
      placedW = overlap;
      game.streak = 0;
      game.nextWidth = placedW;

      var cutX, cutW;
      if (delta > 0) { cutX = overlapRight; cutW = (cur.x + cur.w) - overlapRight; }
      else           { cutX = cur.x;        cutW = overlapLeft - cur.x; }

      if (cutW > 0.5) {
        game.debris.push({
          x: cutX, w: cutW, h: game.blockH,
          y: cur.base, vy: 40, vx: (delta > 0 ? 70 : -70),
          rot: 0, vrot: (delta > 0 ? 2.4 : -2.4),
          style: cur.style, life: 2.0
        });
        SFX.cut();
      }

      game.shake = Math.min(9, Math.abs(delta) * 0.25);
      spawnDust(placedX + placedW / 2, worldToScreenY(cur.base + game.blockH));
      SFX.place();
    }

    game.tower.push({
      x: placedX,
      w: placedW,
      base: cur.base,
      style: cur.style,
      landAt: performance.now()
    });

    game.score++;
    // Кристаллы капают медленно: за обычную установку — ничего,
    // за «ИДЕАЛЬНО!» — 2, плюс 1 за каждые 5 этажей.
    if (game.score % 5 === 0) game.gems += 1;
    if (game.score > profile.best) {
      profile.best = game.score;
      game.newBest = true;
      save(STORE_KEYS.best, profile.best);
    }

    game.moving = null;
    game.phase = PHASE.DROPPING;

    setTimeout(function () {
      if (game.state === STATE.PLAY) spawnMoving();
    }, 110);

    el.tapHint.classList.add('hidden');
    updateHud();
  }

  function spawnPerfectParticles(sx, sy) {
    var colors = ['#6cbf3f', '#e0a33c', '#2fa8a0', '#ffffff'];
    for (var i = 0; i < 24; i++) {
      var a = (Math.PI * 2 * i) / 24 + Math.random() * 0.3;
      var sp = 90 + Math.random() * 180;
      game.particles.push({
        x: sx, y: sy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        size: 2 + Math.random() * 3.5,
        life: 0.55 + Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  function spawnDust(sx, sy) {
    for (var i = 0; i < 7; i++) {
      var a = Math.PI + Math.random() * Math.PI;
      var sp = 30 + Math.random() * 70;
      game.particles.push({
        x: sx + (Math.random() - 0.5) * 30,
        y: sy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - 20,
        size: 1.5 + Math.random() * 2,
        life: 0.3 + Math.random() * 0.25,
        color: '#eaf3dd'
      });
    }
  }

  function spawnPopup(text, color, delay) {
    game.popups.push({ text: text, color: color, t: -(delay || 0), life: 1.0 });
  }

  // Завершение партии: сохраняем рекорд, пишем в лидерборд, показываем экран
  function finishGame() {
    game.state = STATE.OVER;
    profile.gems += game.gems;
    save(STORE_KEYS.gems, profile.gems);

    recordLocalScore(game.score);
    submitRemoteScore(game.score);
    // Засчитываем приглашение только после реально сыгранной партии —
    // так мёртвые переходы по ссылке не приносят бонус
    reportReferral();

    el.hud.classList.add('hidden');
    el.tapHint.classList.add('hidden');

    el.overScore.textContent = game.score;
    el.overBest.textContent = profile.best;
    el.overGems.textContent = game.gems;
    el.overGemsTotal.textContent = profile.gems;
    el.overNewBest.classList.toggle('hidden', !game.newBest);

    showScreen(el.screenOver);
  }

  /* ==========================================================================
     9. ОБНОВЛЕНИЕ И РЕНДЕР
     ========================================================================== */

  var lastTime = 0;

  function update(dt, now) {
    // --- Камера: плавно следует за верхом башни ---
    if (game.state === STATE.PLAY || game.state === STATE.OVER) {
      var desired = towerTopWorld() + game.groundY - VIEW.h * 0.42;
      game.cameraTarget = Math.max(0, desired);
      var k = 1 - Math.pow(0.0015, dt); // сглаживание, не зависящее от FPS
      game.camera += (game.cameraTarget - game.camera) * k;
    }

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 26);

    // --- Движение летящего девайса ---
    if (game.state === STATE.PLAY && game.phase === PHASE.MOVING && game.moving) {
      var m = game.moving;
      var maxX = Math.max(0, VIEW.w - m.w);
      m.x += currentSpeed() * game.dir * dt;

      if (m.x >= maxX) { m.x = maxX; game.dir = -1; }
      else if (m.x <= 0) { m.x = 0; game.dir = 1; }

      m.y = m.base + game.blockH * 2.4 + Math.sin(now * 0.004) * 4;
    }

    // --- Падающие обломки ---
    for (var i = game.debris.length - 1; i >= 0; i--) {
      var d = game.debris[i];
      d.vy += GRAVITY * dt * 0.35;
      d.y -= d.vy * dt;        // вниз = уменьшение «мировой» y
      d.x += d.vx * dt;
      d.rot += d.vrot * dt;
      d.life -= dt;
      if (d.life <= 0 || worldToScreenY(d.y) > VIEW.h + 200) game.debris.splice(i, 1);
    }

    // --- Частицы ---
    for (var j = game.particles.length - 1; j >= 0; j--) {
      var p = game.particles[j];
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) game.particles.splice(j, 1);
    }

    // --- Всплывающий текст ---
    for (var k2 = game.popups.length - 1; k2 >= 0; k2--) {
      var pop = game.popups[k2];
      pop.t += dt;
      if (pop.t > pop.life) game.popups.splice(k2, 1);
    }

    // --- Переход на экран проигрыша после анимации падения ---
    if (game.state === STATE.PLAY && game.phase === PHASE.FALLING_OUT) {
      if (now - game.overAt > 900) finishGame();
    }
  }

  function render(now) {
    var c = ctx;
    c.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
    c.clearRect(0, 0, VIEW.w, VIEW.h);

    drawBackground(now);

    c.save();
    if (game.shake > 0.2) {
      c.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }

    drawGround();

    // --- Башня (рисуем только видимые этажи) ---
    for (var i = 0; i < game.tower.length; i++) {
      var b = game.tower[i];
      var top = worldToScreenY(b.base + game.blockH);
      if (top > VIEW.h + 80 || top + game.blockH < -80) continue;

      // Упругое приземление: короткое сжатие по вертикали
      var h = game.blockH;
      var y = top;
      if (b.landAt) {
        var age = (now - b.landAt) / 220;
        if (age < 1) {
          var squash = Math.sin(age * Math.PI) * 0.16 * (1 - age);
          h = game.blockH * (1 - squash);
          y = top + (game.blockH - h);
        } else {
          b.landAt = 0;
        }
      }
      drawDevice(b.x, y, b.w, h, b.style, { glow: i === game.tower.length - 1 ? 10 : 0 });
      drawBlockContact(b.x, y, b.w, h, i);
    }

    // --- Летящий девайс + «прицел» на верхнем этаже ---
    if (game.moving) {
      var m = game.moving;
      var my = worldToScreenY(m.y + game.blockH);

      var shadowY = worldToScreenY(m.base + game.blockH);
      c.save();
      c.globalAlpha = 0.25;
      c.fillStyle = '#8fbf5a';
      roundRect(c, m.x, shadowY, m.w, 4, 2);
      c.fill();
      c.restore();

      drawDevice(m.x, my, m.w, game.blockH, m.style, { glow: 16, beam: true });
    }

    // --- Обломки ---
    for (var d = 0; d < game.debris.length; d++) {
      var o = game.debris[d];
      var oy = worldToScreenY(o.y + o.h);
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, o.life));
      c.translate(o.x + o.w / 2, oy + o.h / 2);
      c.rotate(o.rot);
      drawDevice(-o.w / 2, -o.h / 2, o.w, o.h, o.style, { glow: 0 });
      c.restore();
    }

    // --- Частицы ---
    for (var p = 0; p < game.particles.length; p++) {
      var pt = game.particles[p];
      c.save();
      c.globalAlpha = Math.max(0, pt.life);
      c.fillStyle = pt.color;
      c.strokeStyle = INK;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    c.restore(); // снимаем тряску

    // --- Всплывающий текст поверх всего, с мультяшной обводкой ---
    for (var q = 0; q < game.popups.length; q++) {
      var pop = game.popups[q];
      if (pop.t < 0) continue;
      var tt = pop.t / pop.life;
      var alpha = tt < 0.15 ? tt / 0.15 : 1 - (tt - 0.15) / 0.85;
      var scale = 0.8 + Math.min(1, tt * 4) * 0.35;
      var yOff = -tt * 46;

      c.save();
      c.globalAlpha = Math.max(0, alpha);
      c.translate(VIEW.w / 2, VIEW.h * 0.4 + yOff + q * 36);
      c.scale(scale, scale);
      c.rotate(-0.04);
      c.font = '900 30px "Trebuchet MS", system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 7;
      c.lineJoin = 'round';
      c.strokeStyle = INK;
      c.strokeText(pop.text, 0, 0);
      c.fillStyle = pop.color;
      c.fillText(pop.text, 0, 0);
      c.restore();
    }
  }

  function loop(now) {
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0.016;
    lastTime = now;

    update(dt, now);
    render(now);

    requestAnimationFrame(loop);
  }

  /* ==========================================================================
     10. ИНТЕРФЕЙС И ВВОД
     ========================================================================== */

  var el = {
    hud: document.getElementById('hud'),
    hudScore: document.getElementById('hudScore'),
    hudGems: document.getElementById('hudGems'),
    hudBest: document.getElementById('hudBest'),
    hudStreak: document.getElementById('hudStreak'),
    streakChip: document.querySelector('.chip-streak'),

    screenStart: document.getElementById('screenStart'),
    screenOver: document.getElementById('screenOver'),
    screenBoard: document.getElementById('screenBoard'),
    screenFriends: document.getElementById('screenFriends'),
    startBest: document.getElementById('startBest'),
    startGems: document.getElementById('startGems'),

    btnPlay: document.getElementById('btnPlay'),
    btnAgain: document.getElementById('btnAgain'),
    btnMenu: document.getElementById('btnMenu'),
    btnSound: document.getElementById('btnSound'),
    btnBoard: document.getElementById('btnBoard'),
    btnBoardBack: document.getElementById('btnBoardBack'),
    btnFriends: document.getElementById('btnFriends'),
    btnFriendsBack: document.getElementById('btnFriendsBack'),
    btnInvite: document.getElementById('btnInvite'),
    btnCopyLink: document.getElementById('btnCopyLink'),

    refCount: document.getElementById('refCount'),
    refEarned: document.getElementById('refEarned'),
    refBonus: document.getElementById('refBonus'),
    refNote: document.getElementById('refNote'),
    toast: document.getElementById('toast'),

    boardList: document.getElementById('boardList'),
    boardNote: document.getElementById('boardNote'),

    overScore: document.getElementById('overScore'),
    overBest: document.getElementById('overBest'),
    overGems: document.getElementById('overGems'),
    overGemsTotal: document.getElementById('overGemsTotal'),
    overNewBest: document.getElementById('overNewBest'),

    screenSkins: document.getElementById('screenSkins'),
    btnSkins: document.getElementById('btnSkins'),
    btnSkinsBack: document.getElementById('btnSkinsBack'),
    skinGrid: document.getElementById('skinGrid'),
    skinPreview: document.getElementById('skinPreview'),
    skinCurrentName: document.getElementById('skinCurrentName'),
    skinStripImg: document.getElementById('skinStripImg'),
    skinStripName: document.getElementById('skinStripName'),
    skinGems: document.getElementById('skinGems'),

    tapHint: document.getElementById('tapHint')
  };

  function updateHud() {
    el.hudScore.textContent = game.score;
    el.hudGems.textContent = game.gems;
    el.hudBest.textContent = profile.best;
    el.hudStreak.textContent = game.streak;
    el.streakChip.classList.toggle('hot', game.streak >= 2);
  }

  function updateMenuStats() {
    el.startBest.textContent = profile.best;
    el.startGems.textContent = profile.gems;
  }

  function showScreen(target) {
    [el.screenStart, el.screenOver, el.screenBoard, el.screenFriends, el.screenSkins].forEach(function (s) {
      s.classList.toggle('hidden', s !== target);
    });
  }

  // Короткое уведомление вместо alert() — само исчезает через 2 секунды
  var toastTimer = 0;
  function showToast(text) {
    el.toast.textContent = text;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.add('hidden');
    }, 2200);
  }

  // --- Экран «Друзья» ---
  function openFriends() {
    game.state = STATE.FRIENDS;
    el.hud.classList.add('hidden');

    el.refBonus.textContent = REF_BONUS;
    el.refCount.textContent = referral.count;
    el.refEarned.textContent = referral.earned;

    // Честно пишем, в каком режиме мы сейчас находимся
    if (!LEADERBOARD_API) {
      el.refNote.textContent = 'Приглашения заработают, когда подключишь сервер: ' +
        'без него нельзя проверить, что друг действительно новый (см. README).';
    } else if (!tg) {
      el.refNote.textContent = 'Открой игру в Telegram, чтобы приглашать друзей.';
    } else {
      el.refNote.textContent = 'Ссылка привязана к твоему аккаунту Telegram.';
      fetchReferralStats().then(function (data) {
        if (data && game.state === STATE.FRIENDS) {
          el.refCount.textContent = referral.count;
          el.refEarned.textContent = referral.earned;
        }
      });
    }

    showScreen(el.screenFriends);
  }

  function goMenu() {
    game.state = STATE.MENU;
    game.moving = null;
    game.debris = [];
    game.particles = [];
    game.popups = [];
    el.hud.classList.add('hidden');
    el.tapHint.classList.add('hidden');
    updateMenuStats();
    updateSkinUI();
    showScreen(el.screenStart);
  }

  // --- Экран скинов: превью, цены, выделение выбранного ---
  function skinBalance() {
    if (el.skinGems) el.skinGems.textContent = profile.gems;
  }

  function updateSkinUI() {
    var sk = activeSkin();
    if (!sk) return;

    if (el.skinPreview) { el.skinPreview.src = sk.img; el.skinPreview.alt = sk.name; }
    if (el.skinCurrentName) el.skinCurrentName.textContent = sk.name;
    if (el.skinStripImg) { el.skinStripImg.src = sk.img; el.skinStripImg.alt = sk.name; }
    if (el.skinStripName) el.skinStripName.textContent = sk.name;
    skinBalance();

    if (!el.skinGrid) return;
    var cards = el.skinGrid.querySelectorAll('.skin-card');
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-skin');
      var owned = isOwned(id);
      var on = id === sk.id;

      cards[i].classList.toggle('selected', on);
      cards[i].classList.toggle('locked', !owned);
      cards[i].setAttribute('aria-pressed', on ? 'true' : 'false');

      var badge = cards[i].querySelector('.skin-badge');
      if (badge) {
        var price = SKINS_BY_ID[id] ? SKINS_BY_ID[id].price : 0;
        badge.textContent = on ? '✓ ВЫБРАН' : (owned ? 'ВЫБРАТЬ' : '◆ ' + price);
        badge.classList.toggle('skin-badge-price', !owned);
      }
    }
  }

  function buildSkinGrid() {
    if (!el.skinGrid) return;
    el.skinGrid.innerHTML = '';

    for (var i = 0; i < SKIN_CATALOG.length; i++) {
      (function (sk) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'skin-card';
        card.setAttribute('data-skin', sk.id);

        var img = document.createElement('img');
        img.className = 'skin-card-img';
        img.src = sk.img;
        img.alt = sk.name;
        img.loading = 'lazy';

        var name = document.createElement('span');
        name.className = 'skin-card-name';
        name.textContent = sk.name;

        var badge = document.createElement('span');
        badge.className = 'skin-badge';

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(badge);

        card.addEventListener('click', function () {
          var result = pickSkin(sk.id);

          if (result === 'bought') {
            SFX.perfect();
            showToast('Скин «' + sk.name + '» открыт!');
            updateMenuStats();
          } else if (result === 'poor') {
            SFX.ui();
            showToast('Не хватает ' + (sk.price - profile.gems) + ' ◆ — сыграй ещё партию');
            return;
          } else {
            SFX.ui();
          }

          updateSkinUI();
        });

        el.skinGrid.appendChild(card);
      })(SKIN_CATALOG[i]);
    }
  }

  function openSkins() {
    game.state = STATE.SKINS;
    el.hud.classList.add('hidden');
    el.tapHint.classList.add('hidden');
    buildSkinGrid();
    updateSkinUI();
    showScreen(el.screenSkins);
  }

  // --- Отрисовка списка лидеров ---
  function renderBoard(rows, isRemote) {
    el.boardList.innerHTML = '';

    if (!rows || !rows.length) {
      var empty = document.createElement('li');
      empty.className = 'board-empty';
      empty.textContent = 'Пока пусто. Сыграй партию — и займёшь первое место.';
      el.boardList.appendChild(empty);
    } else {
      var myKey = tgUser.id || 'local';
      rows.slice(0, 20).forEach(function (row, idx) {
        var li = document.createElement('li');
        li.className = 'board-row' + (String(row.id) === String(myKey) ? ' me' : '');

        var rank = document.createElement('span');
        rank.className = 'board-rank';
        rank.textContent = (idx + 1) + '.';

        var name = document.createElement('span');
        name.className = 'board-name';
        name.textContent = row.name || 'Игрок'; // textContent — защита от HTML-инъекций

        var score = document.createElement('span');
        score.className = 'board-score';
        score.textContent = row.score;

        li.appendChild(rank);
        li.appendChild(name);
        li.appendChild(score);
        el.boardList.appendChild(li);
      });
    }

    el.boardNote.textContent = isRemote
      ? 'Общий рейтинг игроков Telegram.'
      : 'Локальный рейтинг этого устройства. Общий включится, когда подключишь сервер (см. README).';
  }

  function openBoard() {
    game.state = STATE.BOARD;
    el.hud.classList.add('hidden');
    renderBoard(leaderboard.rows, false); // сразу показываем локальные данные
    showScreen(el.screenBoard);

    // Если настроен сервер — подменяем на общий топ, когда он придёт
    fetchRemoteBoard().then(function (remote) {
      if (remote && game.state === STATE.BOARD) {
        leaderboard.remote = true;
        renderBoard(remote, true);
      }
    });
  }

  function refreshToggles() {
    el.btnSound.textContent = settings.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл';
    el.btnSound.setAttribute('aria-pressed', settings.sound ? 'true' : 'false');
  }

  // --- Кнопки ---
  el.btnPlay.addEventListener('click', function () {
    ensureAudio(); SFX.ui();
    startGame();
  });

  el.btnAgain.addEventListener('click', function () { SFX.ui(); startGame(); });
  el.btnMenu.addEventListener('click', function () { SFX.ui(); goMenu(); });
  el.btnBoard.addEventListener('click', function () { SFX.ui(); openBoard(); });
  el.btnBoardBack.addEventListener('click', function () { SFX.ui(); goMenu(); });
  el.btnFriends.addEventListener('click', function () { SFX.ui(); openFriends(); });
  el.btnFriendsBack.addEventListener('click', function () { SFX.ui(); goMenu(); });
  el.btnInvite.addEventListener('click', function () { SFX.ui(); inviteFriend(); });
  el.btnCopyLink.addEventListener('click', function () { SFX.ui(); copyInviteLink(); });
  el.btnSkins.addEventListener('click', function () { SFX.ui(); openSkins(); });
  el.btnSkinsBack.addEventListener('click', function () { SFX.ui(); goMenu(); });

  el.btnSound.addEventListener('click', function () {
    settings.sound = !settings.sound;
    save(STORE_KEYS.sound, settings.sound ? 1 : 0);
    refreshToggles();
    if (settings.sound) { ensureAudio(); SFX.ui(); }
  });

  // --- Основной ввод: тап / клик / пробел ---
  function onTap(e) {
    if (game.state !== STATE.PLAY) return;
    if (e && e.target && e.target.closest && e.target.closest('.btn')) return;
    dropBlock();
  }

  window.addEventListener('pointerdown', onTap, { passive: true });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (game.state === STATE.PLAY) dropBlock();
      else if (game.state === STATE.MENU) { ensureAudio(); startGame(); }
      else if (game.state === STATE.OVER) startGame();
    }
  });

  // Запрещаем двойной тап-зум на iOS
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && audioCtx && audioCtx.state === 'running') {
      try { audioCtx.suspend(); } catch (err) { /* ignore */ }
    }
  });

  /* ==========================================================================
     СТАРТ
     ========================================================================== */

  initTelegram();
  resizeCanvas();
  initClouds();
  preloadSkinImages();
  updateMenuStats();
  updateSkinUI();
  refreshToggles();
  showScreen(el.screenStart);
  requestAnimationFrame(loop);

})();
