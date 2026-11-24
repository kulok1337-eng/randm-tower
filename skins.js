/* ============================================================================
   DRAG TOWER — каталог скинов Огурчика Рика
   ----------------------------------------------------------------------------
   Чтобы добавить новый скин:
     1. Положи PNG 768x256 с прозрачным фоном в 
        (тот же размер и поля 8px, что у остальных спрайтов);
     2. Добавь объект в SKIN_LIST ниже — id, имя, цену, файл, палитру.

   Поля:
     id      — уникальный ключ, пишется в localStorage;
     name    — название в меню;
     desc    — короткое описание;
     price   — цена в кристаллах (0 = открыт сразу);
     img     — путь к спрайту относительно index.html;
     palette — запасные цвета, пока PNG грузится.

   Тело у всех спрайтов одной геометрии: размер, физика и хитбокс одинаковые,
   отличаются только раскраска и аксессуары.
   ============================================================================ */
(function () {
  'use strict';

  // Спрайт: 768x256, прозрачное поле по 8px с каждой стороны.
  // content — прямоугольник самого тела огурчика (без прозрачных полей
  // сверху/снизу). Именно он вписывается в блок, поэтому соседние блоки
  // соприкасаются без зазора. Аксессуары (корона, антенна) могут выходить
  // за пределы content и рисуются поверх — это не влияет на хитбокс.
  var SPRITE = {
    width: 768,
    height: 280,
    content: { x: 24, y: 34, w: 720, h: 200 }
  };

  var SKIN_LIST = [
    {
      id: 'classic',
      bonus: 0,
      name: 'Огурчик Рик',
      desc: 'Тот самый. Немного устал от науки.',
      price: 0,
      img: 'classic.png?v=3',
      palette: { body: '#8fc63d', body2: '#4a7016', accent: '#d9f08a', led: '#f4ffd6' }
    },
    {
      id: 'mint',
      bonus: 4,
      name: 'Мятный Рик',
      desc: 'Освежает и слегка холодит. Пахнет жвачкой.',
      price: 150,
      img: 'mint.png?v=3',
      palette: { body: '#4fbfa8', body2: '#1f6b5c', accent: '#c9fff1', led: '#f0fffa' }
    },
    {
      id: 'ice',
      bonus: 8,
      name: 'Крио-Рик',
      desc: 'Закалён в жидком азоте. Хрустит.',
      price: 360,
      img: 'ice.png?v=3',
      palette: { body: '#6fc3ef', body2: '#2a6ea8', accent: '#d8f3ff', led: '#f0fbff' }
    },
    {
      id: 'chili',
      bonus: 14,
      name: 'Жгучий Рик',
      desc: 'Перец в нём проснулся. Дышит огнём.',
      price: 660,
      img: 'chili.png?v=3',
      palette: { body: '#e8553c', body2: '#7d1a12', accent: '#ffb08f', led: '#fff0e6' }
    },
    {
      id: 'gold',
      bonus: 22,
      name: 'Золотой Рик',
      desc: 'Корона из лабораторного золота.',
      price: 1350,
      img: 'gold.png?v=3',
      palette: { body: '#f7d45c', body2: '#a9771a', accent: '#fff4c2', led: '#fffdf0' }
    },
    {
      id: 'cosmic',
      bonus: 36,
      name: 'Космо-Рик',
      desc: 'Шлем, звёзды и немного космической пыли.',
      price: 2100,
      img: 'cosmic.png?v=3',
      palette: { body: '#8b6de0', body2: '#2a1858', accent: '#cbb8ff', led: '#f4f0ff' }
    },
    {
      id: 'robot',
      bonus: 48,
      name: 'Робо-Рик',
      desc: 'Собран из запчастей портала. Антенна ловит C-137.',
      price: 2700,
      img: 'robot.png?v=3',
      palette: { body: '#b9c3cc', body2: '#5b6770', accent: '#e8f1f5', led: '#ffffff' }
    },
    {
      id: 'magma',
      bonus: 80,
      name: 'Магматический Рик',
      desc: 'Лава вместо сока. Трогать не советуем.',
      price: 3600,
      img: 'magma.png?v=3',
      palette: { body: '#4a3a36', body2: '#1d1512', accent: '#ff7a1a', led: '#ffe3b0' }
    },
    {
      id: 'rich',
      bonus: 90,
      name: 'Богатый Рик',
      desc: 'Цилиндр, сигара и купюры вместо кожи.',
      price: 4500,
      img: 'rich.png?v=3',
      palette: { body: '#5aa84a', body2: '#245c1e', accent: '#ffd85c', led: '#fff6cf' }
    }
  ];

  var api = {
    list: SKIN_LIST,
    sprite: SPRITE,
    storageKey: 'dragtower.skin',
    ownedKey: 'dragtower.owned',
    defaultId: 'classic',

    get: function (id) {
      for (var i = 0; i < SKIN_LIST.length; i++) {
        if (SKIN_LIST[i].id === id) return SKIN_LIST[i];
      }
      return SKIN_LIST[0];
    },

    has: function (id) {
      for (var i = 0; i < SKIN_LIST.length; i++) {
        if (SKIN_LIST[i].id === id) return true;
      }
      return false;
    }
  };

  window.DRAG_SKINS = api;
})();
