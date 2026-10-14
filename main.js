/*
 * Кафе «Шарлотка» — «Лист Шарлотти Мойсеївни»
 * Звичайний скрипт (без модулів), щоб сайт працював і з file://, і на будь-якому хостингу.
 * Усе, що тут робиться, — покращення: без JavaScript сторінка залишається повною й читабельною.
 *
 * Налаштування для власниці (телефон, години, оголошення, месенджери, фото Instagram)
 * живуть у site-config.js, меню — у menu-data.js, тексти — в i18n.js.
 *
 * Порядок запуску: main.js виконується одразу після власних скриптів (мова, меню, статус),
 * а плавна прокрутка й GSAP-анімації вмикаються пізніше, коли підвантажаться бібліотеки з CDN.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var I18N = window.I18N || { uk: {}, ru: {} };
  var MENU = window.MENU_DATA || null;
  var CFG = window.SITE_CONFIG || {};

  /* Значення, вписані в index.html (для сайту без JS). Конфіг їх замінює. */
  var DEF = {
    phoneDisplay: '+380 67 925 58 62',
    email: 'Sharlotka.Odessa@gmail.com',
    open: '10:00',
    close: '23:00'
  };
  var PHONE = {
    display: (CFG.phone && CFG.phone.display) || DEF.phoneDisplay,
    tel: (CFG.phone && CFG.phone.tel) || '+380679255862'
  };
  var INSTAGRAM_URL = CFG.instagram || 'https://www.instagram.com/sharlotka_family_cafe/';
  var INSTAGRAM_PHOTOS = (Array.isArray(CFG.instagramPhotos) && CFG.instagramPhotos.length) ? CFG.instagramPhotos : [];

  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var reduce = reduceMQ.matches;
  var hasGsap = false;          // стає true, коли GSAP + ScrollTrigger завантажились (bootMotion)
  var lenis = null;
  var lang = 'uk';
  var activeTab = null;
  var langHooks = [];
  var bookingClock = null;      // initBooking підставляє сюди оновлення форми «на сьогодні» (див. initClock)

  /* ---------- Допоміжне ---------- */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function t(key) {
    var d = I18N[lang] || {};
    if (has(d, key)) return d[key];
    var u = I18N.uk || {};
    return has(u, key) ? u[key] : '';
  }
  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return (vars && has(vars, k)) ? String(vars[k]) : m; });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function typo(s) { return String(s).replace(/'/g, '’'); }
  function pick(obj) { if (!obj) return ''; return typo(obj[lang] || obj.uk || ''); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* приватний режим */ } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function headerOffset() { var h = $('.site-header'); return h ? h.offsetHeight + 8 : 80; }
  function onLang(fn) { langHooks.push(fn); }
  function icon(id) { return '<svg class="ico" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function hash(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }

  /* Один збій не повинен зупиняти решту сторінки: кожен блок запускаємо окремо. */
  function safe(fn, name) {
    try { fn(); }
    catch (e) {
      root.classList.add('no-anim');
      if (window.console && console.error) console.error('[sharlotka] ' + name, e);
    }
  }
  /* Обіцянки View Transitions, які браузер скасував, не повинні сипати помилками в консоль */
  function quiet(vt) {
    if (!vt) return vt;
    ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { if (vt[k] && vt[k].catch) vt[k].catch(function () {}); });
    return vt;
  }

  /* Нерозривні пробіли після однолітерних слів (і/й/в/у/з/о/а/к/с/я/и, «Ш.»), щоб вони не висіли в кінці рядка */
  var NB_RE = /(^|[\s«(—])([ІіЙйВвУуЗзОоАаКкСсЯяИи]|Ш\.) +/g;
  function nb(s) { return String(s).replace(NB_RE, '$1$2\u00A0').replace(NB_RE, '$1$2\u00A0'); }

  /* Множина: «1 хвилину / 2 хвилини / 5 хвилин» — через Intl.PluralRules */
  function plural(n, key) {
    var forms = String(t(key)).split('|');
    var cat;
    try { cat = new Intl.PluralRules(lang === 'ru' ? 'ru' : 'uk').select(n); }
    catch (e) {
      var a = n % 10, b = n % 100;
      cat = (a === 1 && b !== 11) ? 'one' : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? 'few' : 'many';
    }
    var i = cat === 'one' ? 0 : cat === 'few' ? 1 : 2;
    return forms[i] || forms[forms.length - 1] || '';
  }

  /* =====================================================================
   * Години роботи з site-config.js
   * ===================================================================== */
  function toMin(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function fmtTime(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  var HOURS = (function () {
    var h = CFG.hours || {};
    var o = toMin(h.open), c = toMin(h.close);
    if (o === null) o = toMin(DEF.open);
    if (c === null || c <= o) c = toMin(DEF.close);
    return { o: o, c: c, byDay: h.byDay || {} };
  })();
  /* Є винятки за днями — тоді «щодня» на сторінці вже неправда */
  var HAS_EXC = Object.keys(HOURS.byDay).length > 0;
  function hoursFor(wd) {
    var k = String(wd);
    if (has(HOURS.byDay, k)) {
      var d = HOURS.byDay[k];
      if (!d) return null;
      var o = toMin(d.open), c = toMin(d.close);
      if (o !== null && c !== null && c > o) return { o: o, c: c };
    }
    return { o: HOURS.o, c: HOURS.c };
  }
  function at(min) { return t(Math.floor(min / 60) === 11 ? 'at11' : 'at'); }
  function shortHour(min) { return min % 60 ? fmtTime(min) : String(Math.floor(min / 60)); }
  function baseVars() { return { phone: PHONE.display, open: fmtTime(HOURS.o), close: fmtTime(HOURS.c) }; }

  /* Київський час */
  var kyivFmt = null;
  (function () {
    var opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' };
    try { opts.timeZone = 'Europe/Kyiv'; kyivFmt = new Intl.DateTimeFormat('en-GB', opts); }
    catch (e) {
      try { opts.timeZone = 'Europe/Kiev'; kyivFmt = new Intl.DateTimeFormat('en-GB', opts); }
      catch (e2) { kyivFmt = null; }
    }
  })();
  function kyivNow() {
    var d = new Date();
    if (!kyivFmt || !kyivFmt.formatToParts) {
      return { h: d.getHours(), m: d.getMinutes(), wd: d.getDay(), y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() };
    }
    var o = {};
    kyivFmt.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      h: parseInt(o.hour, 10) % 24, m: parseInt(o.minute, 10),
      wd: days[o.weekday] !== undefined ? days[o.weekday] : d.getDay(),
      y: parseInt(o.year, 10), mo: parseInt(o.month, 10), d: parseInt(o.day, 10)
    };
  }
  function kyivDateStr() { var k = kyivNow(); return k.y + '-' + pad(k.mo) + '-' + pad(k.d); }

  /* =====================================================================
   * Налаштування власниці: телефон, пошта, посилання, години
   * ===================================================================== */
  function textNodes(el) {
    var out = [], w = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, null);
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function initConfig() {
    $$('a[href^="tel:"]').forEach(function (a) {
      a.setAttribute('href', 'tel:' + PHONE.tel);
      textNodes(a).forEach(function (n) { if (n.nodeValue.trim() === DEF.phoneDisplay) n.nodeValue = n.nodeValue.replace(DEF.phoneDisplay, PHONE.display); });
    });
    if (CFG.email) {
      $$('a[href^="mailto:"]').forEach(function (a) {
        a.setAttribute('href', 'mailto:' + CFG.email);
        textNodes(a).forEach(function (n) { if (n.nodeValue.trim() === DEF.email) n.nodeValue = CFG.email; });
      });
    }
    if (CFG.instagram) {
      $$('a[href^="https://www.instagram.com/"]').forEach(function (a) { a.setAttribute('href', CFG.instagram); });
      var handle = /instagram\.com\/([^\/?#]+)/.exec(CFG.instagram);
      var title = $('.insta-title a');
      if (handle && title) title.textContent = '@' + handle[1];
    }
    if (CFG.facebook) $$('a[href^="https://www.facebook.com/"]').forEach(function (a) { a.setAttribute('href', CFG.facebook); });
    if (CFG.maps) {
      if (CFG.maps.route) $$('a[href*="google.com/maps/dir"]').forEach(function (a) { a.setAttribute('href', CFG.maps.route); });
      if (CFG.maps.place) $$('a[href*="google.com/maps/search"]').forEach(function (a) { a.setAttribute('href', CFG.maps.place); });
    }
    var span = shortHour(HOURS.o) + '–' + shortHour(HOURS.c);
    $$('.pm-hours, .acp-a').forEach(function (el) { el.textContent = span; });
    // «ЗА ГРАФІКОМ» довше за «ЩОДНЯ» — щільніше, щоб уміститися у внутрішнє коло штемпеля
    if (HAS_EXC) $$('.pm-day').forEach(function (el) { el.classList.add('is-var'); });
  }

  /* =====================================================================
   * Мова (UA за замовчуванням, RU — перемикачем)
   * ===================================================================== */
  function splitWords(el) {
    var text = el.textContent.trim();
    if (!text) return;
    var words = text.split(/[ \t\r\n]+/);   // нерозривний пробіл тримає слова разом
    el.innerHTML = words.map(function (w, i) {
      return '<span class="w"><span class="wi" style="--wi:' + i + '">' + esc(w) + '</span></span>';
    }).join(' ');
  }
  /* Ключі, значення яких береться з site-config.js */
  function override(key) {
    if (key === 'ct.address' && CFG.address && (CFG.address[lang] || CFG.address.uk)) return CFG.address[lang] || CFG.address.uk;
    if (HAS_EXC && (key === 'ct.hours' || key === 'hero.postmarkDay')) return t(key + 'Var');
    return null;
  }

  function applyLang(next, opts) {
    opts = opts || {};
    if (!opts.initial && !opts.inTransition && doc.startViewTransition && !reduce) {
      try {
        quiet(doc.startViewTransition(function () { applyLang(next, { inTransition: true }); }));
        return;
      } catch (e) { /* без переходу */ }
    }
    lang = next === 'ru' ? 'ru' : 'uk';
    var dict = I18N[lang] || {};
    var v = baseVars();
    root.setAttribute('lang', lang);

    $$('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = override(key);
      if (val === null && has(dict, key)) val = dict[key];
      if (val !== null) {
        var txt = fill(val, v);
        el.textContent = el.tagName === 'TITLE' ? txt : nb(txt);
      }
      if (el.hasAttribute('data-split')) splitWords(el);
    });
    $$('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (has(dict, key)) el.innerHTML = fill(dict[key], v);
    });
    $$('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i < 1) return;
        var attr = pair.slice(0, i).trim();
        var key = pair.slice(i + 1).trim();
        var val = override(key);
        if (val === null && has(dict, key)) val = dict[key];
        if (val !== null) el.setAttribute(attr, fill(val, v));
      });
    });

    $$('.lang-btn').forEach(function (b) {
      if (b.getAttribute('data-lang') === lang) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });

    var ogLocale = $('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute('content', lang === 'ru' ? 'ru_UA' : 'uk_UA');
    var ogAlt = $('meta[property="og:locale:alternate"]');
    if (ogAlt) ogAlt.setAttribute('content', lang === 'ru' ? 'uk_UA' : 'ru_UA');
    var canon = $('link[rel="canonical"]');
    if (canon) {
      if (!canon.hasAttribute('data-base')) canon.setAttribute('data-base', canon.getAttribute('href') || '');
      var base = canon.getAttribute('data-base').replace(/\?.*$/, '');
      canon.setAttribute('href', lang === 'ru' ? base + '?lang=ru' : base);
    }

    safe(renderMenu, 'menu');
    safe(renderInstagram, 'insta');
    safe(updateStatus, 'status');
    safe(markToday, 'today');
    langHooks.forEach(function (fn) { safe(fn, 'lang-hook'); });

    if (!opts.initial) {
      lsSet('sh-lang', lang);
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('lang', lang);
        window.history.replaceState(null, '', url.toString());
      } catch (e) { /* file:// у деяких браузерах не дозволяє — не страшно */ }
      if (hasGsap) window.ScrollTrigger.refresh();
    }
  }

  function initLang() {
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(window.location.search).get('lang'); } catch (e) { fromUrl = null; }
    var initial = (fromUrl === 'ru' || fromUrl === 'uk') ? fromUrl : (lsGet('sh-lang') === 'ru' ? 'ru' : 'uk');
    applyLang(initial, { initial: true });

    $$('.lang-btn').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var next = b.getAttribute('data-lang');
        if (next !== lang) applyLang(next);
      });
    });
  }

  /* =====================================================================
   * Статус: «Відчинено · до 23:00» / «Зачинимося за N хвилин» / «Зачинено · відкриємося о 10:00»
   * ===================================================================== */
  function updateStatus() {
    var k = kyivNow();
    var mins = k.h * 60 + k.m;
    var today = hoursFor(k.wd);
    var state = 'closed', text = '';
    if (today && mins >= today.o && mins < today.c) {
      var left = today.c - mins;
      if (left < 60) { state = 'soon'; text = fill(t('status.soon'), { n: left, min: plural(left, 'plural.min') }); }
      else { state = 'open'; text = fill(t('status.open'), { close: fmtTime(today.c) }); }
    } else if (today && mins < today.o) {
      text = fill(t('status.closedToday'), { at: at(today.o), open: fmtTime(today.o) });
    } else {
      for (var i = 1; i <= 7; i++) {
        var wd = (k.wd + i) % 7, h = hoursFor(wd);
        if (!h) continue;
        text = i === 1
          ? fill(t('status.closedTomorrow'), { at: at(h.o), open: fmtTime(h.o) })
          : fill(t('status.closedDay'), { day: t('dayAcc.' + wd), at: at(h.o), open: fmtTime(h.o) });
        break;
      }
      if (!text) text = fill(t('status.static'), baseVars());
    }
    $$('.js-status').forEach(function (chip) {
      chip.setAttribute('data-state', state);
      var el = $('.status-text', chip);
      if (el) el.textContent = text;
    });
  }

  function markToday() {
    var wd = kyivNow().wd;
    $$('#hours li').forEach(function (li) {
      var day = parseInt(li.getAttribute('data-day'), 10);
      var h = hoursFor(day);
      var time = $('.hours-time', li);
      if (time) time.textContent = h ? fmtTime(h.o) + '–' + fmtTime(h.c) : t('ct.dayOff');
      var isToday = wd === day;
      li.classList.toggle('is-today', isToday);
      var first = li.firstElementChild;
      if (first) {
        if (isToday) first.setAttribute('data-today', t('ct.today'));
        else first.removeAttribute('data-today');
      }
      if (isToday) li.setAttribute('aria-current', 'date'); else li.removeAttribute('aria-current');
    });
  }

  function initClock() {
    function refreshClock() {
      safe(updateStatus, 'status');
      safe(markToday, 'today');
      if (bookingClock) safe(bookingClock, 'booking-clock');
    }
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) refreshClock(); });
    window.addEventListener('pageshow', refreshClock);
    // Оновлюємо рівно на початку кожної хвилини
    window.setTimeout(function () {
      refreshClock();
      window.setInterval(refreshClock, 60 * 1000);
    }, 60000 - Date.now() % 60000 + 50);
  }

  /* =====================================================================
   * Меню з menu-data.js: вкладки (ARIA tabs) + сторінки + пошук
   * ===================================================================== */
  function categories() {
    if (!MENU || !Array.isArray(MENU.categories)) return [];
    return MENU.categories.filter(function (c) { return c && c.id !== undefined && c.title; }).map(function (c) {
      c._sid = String(c.id).replace(/[^A-Za-z0-9_-]/g, '-');
      return c;
    });
  }
  function showPrices() {
    if (typeof CFG.showPrices === 'boolean') return CFG.showPrices;
    return MENU ? MENU.showPrices !== false : true;
  }
  function priceNote() {
    if (CFG.priceNote && (CFG.priceNote[lang] || CFG.priceNote.uk)) return pick(CFG.priceNote);
    if (MENU && MENU.priceNote) return pick(MENU.priceNote);
    return t('menu.priceNote');
  }
  function hasTag(it, tag) { return it.tag === tag || (Array.isArray(it.tags) && it.tags.indexOf(tag) >= 0); }

  function priceHtml(price, cur) {
    if (price === undefined || price === null || price === '') return '';
    var val = Array.isArray(price) ? price.join(' / ') : String(price);
    return '<span class="mc-price">' + esc(val) + '<span class="mc-cur">' + esc(cur) + '</span></span>';
  }

  /* ---- Пошук: нормалізація, що зближує українське й російське письмо ---- */
  var FOLD = { 'і': 'и', 'ї': 'и', 'ы': 'и', 'й': 'и', 'є': 'е', 'э': 'е', 'ё': 'е', 'ґ': 'г', 'ь': '', 'ъ': '', '\'': '', '’': '', 'ʼ': '', '`': '', '«': '', '»': '', '"': '' };
  /* розділові знаки перетворюємо на пробіли — шукаємо від початку слова */
  ' -‑–—,.;:!?()/+\u00A0\t\n'.split('').forEach(function (ch) { FOLD[ch] = ' '; });
  function foldMap(text) {
    var src = String(text).toLowerCase(), s = '', idx = [], prev = '';
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (has(FOLD, ch)) ch = FOLD[ch];
      if (!ch) continue;
      if (ch === prev && /[a-zа-я]/.test(ch)) continue;   // «пицца» ≈ «піца», «феттучини» ≈ «фетучіні»
      if (ch === ' ' && prev === ' ') continue;
      s += ch; idx.push(i); prev = ch;
    }
    return { s: s, idx: idx };
  }
  function fold(text) { return foldMap(text).s; }
  function hl(text, words) {
    text = String(text);
    if (!words || !words.length) return esc(text);
    var fm = foldMap(text), marks = [];
    words.forEach(function (w) {
      var from = 0, pos;
      while (w && (pos = fm.s.indexOf(w, from)) >= 0) {
        from = pos + 1;
        if (pos > 0 && fm.s.charAt(pos - 1) !== ' ') continue;   // лише з початку слова
        var a = fm.idx[pos], b = fm.idx[pos + w.length - 1];
        for (var i = a; i <= b; i++) marks[i] = true;
      }
    });
    var out = '', open = false;
    for (var j = 0; j < text.length; j++) {
      if (marks[j] && !open) { out += '<mark class="mc-hl">'; open = true; }
      if (!marks[j] && open) { out += '</mark>'; open = false; }
      out += esc(text.charAt(j));
    }
    return out + (open ? '</mark>' : '');
  }

  function itemHtml(it, sp, cur, words) {
    var badges = '';
    if (hasTag(it, 'praised')) badges += '<span class="badge badge--praised">' + icon('i-heart') + esc(t('badge.praised')) + '</span>';
    if (hasTag(it, 'veg')) badges += '<span class="badge badge--veg">' + icon('i-leaf') + esc(t('badge.veg')) + '</span>';
    var name = pick(it.name), info = it.info ? pick(it.info) : '';
    var alt = '';
    if (words && words.length && it.name) {
      var otherLang = lang === 'ru' ? 'uk' : 'ru';
      var visible = ' ' + fold(name + ' ' + info);
      var other = it.name[otherLang] ? typo(it.name[otherLang]) : '';
      var otherF = ' ' + fold(other);
      if (other && otherF !== ' ' + fold(name) && words.some(function (w) { return visible.indexOf(' ' + w) < 0 && otherF.indexOf(' ' + w) >= 0; })) {
        alt = '<span class="mc-alt">' + esc(t('menu.altLang')) + ' ' + hl(other, words) + '</span>';
      }
    }
    var infoEl = info ? '<span class="mc-info">' + hl(info, words) + '</span>' : '';
    var meta = (infoEl || alt || badges) ? '<span class="mc-meta">' + infoEl + alt + badges + '</span>' : '';
    var price = sp ? '<span class="mc-dots" aria-hidden="true"></span>' + priceHtml(it.price, cur) : '';
    return '<li class="mc-item"><span class="mc-line"><span class="mc-name">' + hl(name, words) + '</span>' + price + '</span>' + meta + '</li>';
  }

  function renderMenu() {
    var tabsEl = $('#menu-tabs');
    var panelsEl = $('#menu-panels');
    var cats = categories();
    if (!cats.length || !tabsEl || !panelsEl) return;
    var sp = showPrices();
    var cur = MENU.currency ? pick(MENU.currency) : 'грн';
    if (!activeTab || !cats.some(function (c) { return c._sid === activeTab; })) activeTab = cats[0]._sid;

    tabsEl.innerHTML = cats.map(function (c) {
      var sel = c._sid === activeTab;
      return '<button class="mc-tab" type="button" role="tab" id="tab-' + c._sid + '" aria-controls="panel-' + c._sid + '" aria-selected="' + sel + '" tabindex="' + (sel ? '0' : '-1') + '" data-tab="' + c._sid + '">' + esc(pick(c.title)) + '</button>';
    }).join('');

    panelsEl.innerHTML = cats.map(function (c) {
      var sel = c._sid === activeTab;
      var sub = c.subtitle ? '<p class="mc-cat-sub">' + esc(pick(c.subtitle)) + '</p>' : '';
      var note = c.note ? '<p class="mc-cat-note">' + esc(pick(c.note)) + '</p>' : '';
      return '<div class="mc-panel" role="tabpanel" id="panel-' + c._sid + '" aria-labelledby="tab-' + c._sid + '" tabindex="0"' + (sel ? '' : ' hidden') + '>' +
        '<div class="mc-panel-head"><h3 class="mc-cat-title">' + esc(pick(c.title)) + '</h3>' + sub + note + '</div>' +
        '<ul class="mc-items">' + (c.items || []).map(function (it) { return itemHtml(it, sp, cur, null); }).join('') + '</ul></div>';
    }).join('');

    var note = $('.js-price-note');
    if (note) note.textContent = priceNote();
    var noteWrap = $('.price-note');
    if (noteWrap) noteWrap.hidden = !sp;
    renderResults(false);
  }

  /* ---- Пошук ---- */
  var menuState = { q: '', veg: false };
  function searching() { return !!(menuState.q || menuState.veg); }
  /* Грубе «обрізання» закінчень: «вишня» → «вишн» (знайде «з вишнею»), «курица» → «куриц», «гриби» → «гриб».
     Працює вже зі згорнутим словом (й→и, є→е…), тому закінчення тут у згорнутому вигляді. Основа — щонайменше 4 літери. */
  var END_RE = /(ами|ями|ого|ому|его|ему|ою|ею|ои|еи|ии|ая|яя|ое|ее|ие|ом|ем|ам|ям|ах|ях|ов|ев|ив|и|а|я|у|ю|е|о)$/;
  function stem(w) {
    if (w.length < 5) return w;
    var s = w.replace(END_RE, '');
    return s.length >= 4 ? s : w.slice(0, 4);
  }
  function queryWords() { return fold(menuState.q).split(' ').filter(function (w) { return w.length > 0; }).map(stem); }
  function itemHay(it, c) {
    var parts = [];
    ['name', 'info'].forEach(function (f) { if (it[f]) parts.push(it[f].uk, it[f].ru); });
    if (Array.isArray(it.keywords)) parts = parts.concat(it.keywords);
    if (c && c.title) parts.push(c.title.uk, c.title.ru);
    if (c && Array.isArray(c.keywords)) parts = parts.concat(c.keywords);
    return ' ' + fold(parts.join(' ')) + ' ';
  }
  function renderResults(fresh) {
    var box = $('#menu-results');
    var panelsEl = $('#menu-panels');
    var card = $('.menu-card');
    var countEl = $('.mc-count');
    var clearBtn = $('.mc-q-clear');
    if (!box || !panelsEl) return;
    var on = searching();
    if (card) card.classList.toggle('is-searching', on);
    if (clearBtn) clearBtn.hidden = !menuState.q;
    box.hidden = !on;
    panelsEl.hidden = on;
    if (!on) { box.innerHTML = ''; if (countEl) countEl.textContent = ''; return; }

    var words = queryWords(), n = 0, html = '';
    var sp = showPrices();
    var cur = MENU && MENU.currency ? pick(MENU.currency) : 'грн';
    categories().forEach(function (c) {
      var items = (c.items || []).filter(function (it) {
        if (!it || !it.name) return false;
        if (menuState.veg && !hasTag(it, 'veg')) return false;
        if (!words.length) return true;
        var hay = itemHay(it, c);
        return words.every(function (w) { return hay.indexOf(' ' + w) >= 0; });
      });
      if (!items.length) return;
      n += items.length;
      html += '<section class="mc-group" aria-labelledby="mg-' + c._sid + '"><h3 class="mc-group-title" id="mg-' + c._sid + '">' + hl(pick(c.title), words) + '</h3>' +
        '<ul class="mc-items">' + items.map(function (it) { return itemHtml(it, sp, cur, words); }).join('') + '</ul></section>';
    });
    if (!n) {
      html = '<div class="mc-empty"><p class="mc-empty-text">' + esc(t('menu.empty')) + '</p><div class="mc-empty-actions">' +
        '<a class="btn btn--cherry" href="tel:' + esc(PHONE.tel) + '">' + icon('i-phone') + '<span>' + esc(PHONE.display) + '</span></a>' +
        '<button class="btn btn--ink-outline mc-reset" type="button">' + esc(t('menu.reset')) + '</button></div></div>';
    }
    box.innerHTML = html;
    if (fresh && !reduce) { box.classList.remove('is-fresh'); void box.offsetWidth; box.classList.add('is-fresh'); }
    if (countEl) countEl.textContent = n ? fill(t('menu.found'), { n: n, dish: plural(n, 'plural.dish') }) : t('menu.none');
  }
  function resetSearch() {
    menuState.q = ''; menuState.veg = false;
    var q = $('#menu-q'); if (q) q.value = '';
    var veg = $('.mc-veg'); if (veg) veg.setAttribute('aria-pressed', 'false');
    renderResults(false);
  }

  function selectTab(id, focusTab) {
    var tabsEl = $('#menu-tabs');
    if (!tabsEl || !doc.getElementById('tab-' + id)) return;
    if (searching()) resetSearch();
    var apply = function () {
      activeTab = id;
      $$('.mc-tab', tabsEl).forEach(function (b) {
        var sel = b.getAttribute('data-tab') === id;
        b.setAttribute('aria-selected', String(sel));
        b.setAttribute('tabindex', sel ? '0' : '-1');
      });
      $$('.mc-panel', $('#menu-panels')).forEach(function (p) { p.hidden = p.id !== 'panel-' + id; });
    };
    var panels = $('#menu-panels');
    if (id === activeTab) { apply(); }
    else if (doc.startViewTransition && !reduce) {
      panels.style.viewTransitionName = 'menu-panel';
      try {
        var vt = quiet(doc.startViewTransition(apply));
        var done = function () { panels.style.viewTransitionName = ''; };
        if (vt && vt.finished) vt.finished.then(done, done); else done();
      } catch (e) { apply(); panels.style.viewTransitionName = ''; }
    } else {
      apply();
      var p = doc.getElementById('panel-' + id);
      if (p && !reduce) { p.classList.remove('is-entering'); void p.offsetWidth; p.classList.add('is-entering'); }
    }
    var tab = doc.getElementById('tab-' + id);
    if (tab) {
      if (focusTab) tab.focus();
      var wrap = tab.parentElement && tab.parentElement.parentElement;
      if (wrap && tab.parentElement.scrollWidth > wrap.clientWidth) {
        wrap.scrollTo({ left: tab.offsetLeft - wrap.clientWidth / 2 + tab.offsetWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
      }
    }
  }

  function initMenu() {
    var tabsEl = $('#menu-tabs');
    if (!tabsEl) return;
    tabsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.mc-tab');
      if (b) selectTab(b.getAttribute('data-tab'), false);
    });
    tabsEl.addEventListener('keydown', function (e) {
      var tabs = $$('.mc-tab', tabsEl);
      var i = tabs.indexOf(doc.activeElement);
      if (i < 0) return;
      var n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      selectTab(tabs[n].getAttribute('data-tab'), true);
    });
    $$('[data-menu-tab]').forEach(function (a) {
      a.addEventListener('click', function () { selectTab(a.getAttribute('data-menu-tab'), false); });
    });
  }

  function initSearch() {
    var wrap = $('.mc-search');
    var q = $('#menu-q');
    if (!wrap || !q || !categories().length) return;
    wrap.hidden = false;
    var veg = $('.mc-veg');
    var clear = $('.mc-q-clear');
    var box = $('#menu-results');
    var timer = 0;
    q.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        var v = q.value.trim();
        if (v === menuState.q) return;
        menuState.q = v;
        renderResults(true);
      }, 120);
    });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; menuState.q = ''; renderResults(false); }
      if (e.key === 'Enter') e.preventDefault();
    });
    if (clear) clear.addEventListener('click', function () { q.value = ''; menuState.q = ''; renderResults(false); q.focus(); });
    if (veg) veg.addEventListener('click', function () {
      menuState.veg = !menuState.veg;
      veg.setAttribute('aria-pressed', String(menuState.veg));
      renderResults(true);
    });
    if (box) box.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.mc-reset')) { resetSearch(); q.focus(); }
    });
  }

  /* =====================================================================
   * Instagram-сітка з site-config.js → instagramPhotos
   * ===================================================================== */
  var instaDone = false;
  function renderInstagram() {
    var grid = $('#insta-grid');
    if (!grid || !INSTAGRAM_PHOTOS.length) return;
    if (instaDone) {   // при зміні мови міняємо лише підписи, не перезавантажуючи фото
      $$('img', grid).forEach(function (img, i) {
        var p = INSTAGRAM_PHOTOS[i];
        if (p && p.alt) img.alt = p.alt[lang] || p.alt.uk || '';
      });
      return;
    }
    grid.innerHTML = INSTAGRAM_PHOTOS.map(function (p) {
      var alt = p.alt ? (p.alt[lang] || p.alt.uk || '') : '';
      return '<li><a href="' + esc(p.link || INSTAGRAM_URL) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(p.src) + '" width="' + (p.w || 1080) + '" height="' + (p.h || 1080) + '" loading="lazy" decoding="async" alt="' + esc(alt) + '"></a></li>';
    }).join('');
    instaDone = true;
  }

  /* =====================================================================
   * Появи при прокрутці (IntersectionObserver)
   * ===================================================================== */
  var revealIO = null;
  function initReveal() {
    var els = $$('[data-reveal], [data-photo], .letter-sign, .peek-cat, .it-visual');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      $$('.map-card, .peek-cat').forEach(function (el) { el.classList.add('is-live'); });
      return;
    }
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); revealIO.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px 6% 0px', threshold: 0.01 });
    els.forEach(function (el) { revealIO.observe(el); });

    // Нескінченні SVG-анімації (маршрут, шпилька, кліпання кота) — лише коли їх видно
    var liveIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('is-live', en.isIntersecting); });
    });
    $$('.map-card, .peek-cat').forEach(function (el) { liveIO.observe(el); });
  }

  /* =====================================================================
   * Шапка, активний розділ, мобільна панель
   * ===================================================================== */
  function initHeader() {
    var header = $('.site-header');
    var dock = $('.dock');
    var ticking = false;
    function onScroll() {
      var y = window.scrollY || window.pageYOffset;
      if (header) header.classList.toggle('at-top', y < 12);
      ticking = false;
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();

    var links = $$('.main-nav a');
    if ('IntersectionObserver' in window && links.length) {
      var map = {};
      links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) { a.classList.remove('is-current'); a.removeAttribute('aria-current'); });
          var a = map[en.target.id];
          if (a) { a.classList.add('is-current'); a.setAttribute('aria-current', 'location'); }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { var s = doc.getElementById(id); if (s) io.observe(s); });
      var heroSec = doc.getElementById('top');
      if (heroSec) io.observe(heroSec);   // над першим розділом — жоден пункт не підсвічений
    }

    // Мобільна панель ховається, коли видно футер (щоб не закривати контакти)
    var footer = $('.site-footer');
    if (dock && footer && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { dock.classList.toggle('is-away', en.isIntersecting && en.intersectionRatio > 0.35); });
      }, { threshold: [0, 0.35, 0.6] }).observe(footer);
    }
  }

  /* ---------- «Зміст» (мобільне меню) ---------- */
  function initToc() {
    var btn = $('.toc-btn');
    var toc = $('#toc');
    if (!btn || !toc) return;
    var sheet = $('.toc-sheet', toc);
    var lastFocus = null;

    function focusables() { return $$('a[href], button:not([disabled])', sheet); }
    function open() {
      lastFocus = doc.activeElement;
      toc.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      doc.body.style.overflow = 'hidden';
      root.style.overflow = 'hidden';
      if (lenis) lenis.stop();
      var f = focusables();
      if (f[0]) f[0].focus();
    }
    function close(restore) {
      toc.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      doc.body.style.overflow = '';
      root.style.overflow = '';
      if (lenis) lenis.start();
      if (restore !== false && lastFocus) lastFocus.focus();
    }
    btn.addEventListener('click', function () { if (toc.hidden) open(); else close(); });
    $('.toc-close', toc).addEventListener('click', function () { close(); });
    toc.addEventListener('click', function (e) {
      if (e.target === toc) close();
      var a = e.target.closest('a[href^="#"]');
      if (a) close(false);
    });
    // Escape і «пастка» фокуса працюють, навіть якщо фокус випав на body (клік по порожньому місцю)
    doc.addEventListener('keydown', function (e) {
      if (toc.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!sheet.contains(doc.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* =====================================================================
   * Якорі (працюють одразу) + плавна прокрутка Lenis (після CDN)
   * ===================================================================== */
  function initAnchors() {
    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute('href');
      if (!id || id.length < 2) return;
      var target = doc.getElementById(id.slice(1));
      if (!target) return;
      e.preventDefault();
      var offset = (id === '#top') ? 0 : -headerOffset();
      if (lenis) lenis.scrollTo(target, { offset: offset, duration: 1.35 });
      else {
        var y = target.getBoundingClientRect().top + window.pageYOffset + offset;
        window.scrollTo({ top: id === '#top' ? 0 : y, behavior: reduce ? 'auto' : 'smooth' });
      }
      if (id === '#main' || target.matches('section, main, .booking')) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  }

  function scrollToHash() {
    var id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch (e) { id = ''; }
    var el = id && doc.getElementById(id);
    if (!el) return;
    var off = id === 'top' ? 0 : -headerOffset();
    if (lenis) lenis.scrollTo(el, { offset: off, immediate: true, force: true });
    else window.scrollTo(0, el.getBoundingClientRect().top + window.pageYOffset + off);
  }

  function initSmooth() {
    if (!reduce && typeof window.Lenis === 'function') {
      try { lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 }); } catch (e) { lenis = null; }
    }
    if (lenis) {
      if (hasGsap) {
        lenis.on('scroll', window.ScrollTrigger.update);
        window.gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
        window.gsap.ticker.lagSmoothing(0);
      } else {
        var raf = function (time) { lenis.raf(time); window.requestAnimationFrame(raf); };
        window.requestAnimationFrame(raf);
      }
    }
    window.addEventListener('hashchange', scrollToHash);
  }

  /* ---------- «Вареничний бум» як гортальна стрічка для клавіатури (коли він не закріплений) ---------- */
  var vbMQ = window.matchMedia ? window.matchMedia('(max-width: 999px)') : { matches: true };
  function vbScroller() {
    var vb = $('.vb'), vp = $('.vb-viewport');
    if (!vb || !vp) return;
    var on = vbMQ.matches && !vb.classList.contains('is-pinned');
    if (on) {
      vp.setAttribute('tabindex', '0');
      vp.setAttribute('role', 'region');
      vp.setAttribute('aria-label', t('vb.title'));
    } else {
      vp.removeAttribute('tabindex'); vp.removeAttribute('role'); vp.removeAttribute('aria-label');
    }
  }
  function initVb() {
    vbScroller();
    onLang(vbScroller);
    if (vbMQ.addEventListener) vbMQ.addEventListener('change', vbScroller);
    else if (vbMQ.addListener) vbMQ.addListener(vbScroller);
  }

  /* =====================================================================
   * GSAP: закріплена «вареникова» історія, лист із конверта, паралакс марок
   * ===================================================================== */
  function initGsap() {
    if (!hasGsap || reduce) return;
    var gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);
    var mm = gsap.matchMedia();

    // Вареничний бум — горизонтальна сторінка, що гортається прокруткою
    mm.add('(min-width: 1000px) and (min-height: 620px) and (max-height: 1600px)', function () {
      var vb = $('.vb');
      var track = $('.vb-track');
      var viewport = $('.vb-viewport');
      var bar = $('.vb-progress span');
      if (!vb || !track || !viewport) return;
      vb.classList.add('is-pinned');
      vbScroller();
      function dist() {
        var pl = parseFloat(window.getComputedStyle(viewport).paddingLeft) || 0;
        return Math.max(0, track.scrollWidth + pl * 2 - window.innerWidth);
      }
      var tw = gsap.to(track, {
        x: function () { return -dist(); },
        ease: 'none',
        scrollTrigger: {
          trigger: vb, start: 'top top', end: function () { return '+=' + dist(); },
          pin: true, scrub: 0.7, invalidateOnRefresh: true, anticipatePin: 1,
          onUpdate: function (self) { if (bar) bar.style.transform = 'scaleX(' + self.progress.toFixed(3) + ')'; }
        }
      });
      $$('.vb-step figure').forEach(function (fig, i) {
        gsap.fromTo(fig, { yPercent: i % 2 ? -6 : 6 }, {
          yPercent: i % 2 ? 6 : -6, ease: 'none',
          scrollTrigger: { trigger: fig, containerAnimation: tw, start: 'left right', end: 'right left', scrub: true }
        });
      });
      // Клавіатура / пошук на сторінці: замість того щоб браузер зсунув стрічку вбік,
      // прокручуємо сторінку до місця, де потрібна картка стоїть у центрі
      function onFocusIn(e) {
        var st = tw.scrollTrigger;
        if (!st) return;
        vb.scrollLeft = 0; viewport.scrollLeft = 0;
        var card = e.target.closest ? e.target.closest('.vb-card') : null;
        if (!card) return;
        var d = dist();
        var want = card.offsetLeft + card.offsetWidth / 2 - window.innerWidth / 2;
        var p = d ? Math.min(1, Math.max(0, want / d)) : 0;
        var y = st.start + (st.end - st.start) * p;
        // після того, як браузер сам прокрутить до елемента у фокусі
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            vb.scrollLeft = 0; viewport.scrollLeft = 0;
            if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y);
          });
        });
      }
      function onVbScroll() { if (vb.scrollLeft) vb.scrollLeft = 0; if (viewport.scrollLeft) viewport.scrollLeft = 0; }
      vb.addEventListener('focusin', onFocusIn);
      vb.addEventListener('scroll', onVbScroll);
      viewport.addEventListener('scroll', onVbScroll);
      return function () {
        vb.removeEventListener('focusin', onFocusIn);
        vb.removeEventListener('scroll', onVbScroll);
        viewport.removeEventListener('scroll', onVbScroll);
        vb.classList.remove('is-pinned');
        gsap.set(track, { clearProps: 'x' });
        vbScroller();
      };
    });

    // Лист виїжджає з конверта
    var letter = $('.letter');
    if (letter) {
      gsap.fromTo(letter, { yPercent: window.innerWidth < 700 ? 12 : 18 }, {
        yPercent: 0, ease: 'none',
        scrollTrigger: { trigger: '.envelope', start: 'top bottom', end: 'top 45%', scrub: 0.8 }
      });
      gsap.fromTo('.seal', { rotation: -50, scale: 0.55 }, {
        rotation: 0, scale: 1, ease: 'back.out(2)',
        scrollTrigger: { trigger: '.envelope', start: 'top 70%', end: 'top 30%', scrub: 0.8 }
      });
    }

    // Марки в hero: легкий паралакс при прокрутці (рухаємо обгортки з тінню — так дешевше) і рух за курсором
    function heroST() { return { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }; }
    gsap.to('.st-rot', { rotation: 220, svgOrigin: '100 100', ease: 'none', scrollTrigger: heroST() });
    gsap.to('.stamp-wrap--b', { yPercent: -22, ease: 'none', scrollTrigger: heroST() });
    gsap.to('.stamp-wrap--c', { yPercent: 16, ease: 'none', scrollTrigger: heroST() });
    gsap.to('.postmark svg', { yPercent: -40, ease: 'none', scrollTrigger: heroST() });

    mm.add('(min-width: 1000px) and (pointer: fine)', function () {
      var hero = $('.hero');
      var layers = [
        { el: $('.stamp-wrap--main .stamp'), k: 10 }, { el: $('.stamp-wrap--b .stamp'), k: 22 },
        { el: $('.stamp-wrap--c .stamp'), k: 30 }
      ].filter(function (l) { return l.el; });
      var movers = layers.map(function (l) {
        return { k: l.k, x: gsap.quickTo(l.el, 'x', { duration: 0.9, ease: 'power3.out' }), y: gsap.quickTo(l.el, 'y', { duration: 0.9, ease: 'power3.out' }) };
      });
      function move(e) {
        var r = hero.getBoundingClientRect();
        var dx = (e.clientX - r.left) / r.width - 0.5;
        var dy = (e.clientY - r.top) / r.height - 0.5;
        movers.forEach(function (m) { m.x(dx * m.k); m.y(dy * m.k); });
      }
      hero.addEventListener('pointermove', move);
      return function () { hero.removeEventListener('pointermove', move); };
    });

    // Схема піци повільно обертається під тарілкою
    gsap.fromTo('.pd-rot', { rotation: -14 }, { rotation: 14, ease: 'none', svgOrigin: '200 200', scrollTrigger: { trigger: '.it-visual', start: 'top bottom', end: 'bottom top', scrub: true } });

    // Після завантаження шрифтів і картинок — перерахувати позиції й (для посилань виду #menu) доїхати до якоря
    function afterLoad() { window.ScrollTrigger.refresh(); window.requestAnimationFrame(scrollToHash); }
    if (doc.readyState === 'complete') afterLoad(); else window.addEventListener('load', afterLoad);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { window.ScrollTrigger.refresh(); });
  }

  /* =====================================================================
   * Листівки: колода, яку можна гортати, тягнути й перевертати
   * ===================================================================== */
  function initStack() {
    var stack = $('#stack');
    if (!stack) return;
    var cards = $$('.pc', stack);
    if (cards.length < 2) return;
    var controls = $('.stack-controls');
    var count = $('.js-count');
    var total = $('.js-total');
    var order = cards.map(function (c, i) { return i; });
    var rots = [-3, 2.6, -1.8, 3.4, -2.6, 1.8, -3.6, 2.2, -1.4, 3];
    var busy = false;
    stack.classList.add('is-stacked');
    stack.setAttribute('tabindex', '0');
    if (controls) controls.hidden = false;

    // Глибокі листівки (їх не видно) завантажуємо, лише коли вони підходять до верху колоди
    cards.forEach(function (c, i) {
      if (i <= 4) return;
      var im = $('img', c);
      if (im && im.getAttribute('src')) { im.setAttribute('data-src', im.getAttribute('src')); im.removeAttribute('src'); }
    });

    function layout() {
      order.forEach(function (ci, pos) {
        var c = cards[ci];
        var depth = Math.min(pos, 4);
        c.style.setProperty('--z', String(cards.length - pos));
        c.style.setProperty('--x', (depth * 12) + 'px');
        c.style.setProperty('--y', (depth * -10) + 'px');
        c.style.setProperty('--r', (pos === 0 ? rots[ci % rots.length] * 0.35 : rots[ci % rots.length]) + 'deg');
        c.style.setProperty('--s', String(1 - depth * 0.04));
        c.style.setProperty('--o', pos > 4 ? '0' : '1');
        c.classList.toggle('is-top', pos === 0);
        if (pos !== 0) c.classList.remove('is-flipped');
        if (pos <= 4) {
          var im = $('img[data-src]', c);
          if (im) { im.setAttribute('src', im.getAttribute('data-src')); im.removeAttribute('data-src'); }
        }
      });
      if (count) count.textContent = pad(order[0] + 1);
      if (total) total.textContent = pad(cards.length);
    }
    function throwTop(dir) {
      if (busy) return;
      busy = true;
      var c = cards[order[0]];
      c.classList.remove('is-dragging');
      c.style.setProperty('--x', (dir * (stack.offsetWidth * 1.15)) + 'px');
      c.style.setProperty('--y', '40px');
      c.style.setProperty('--r', (dir * 16) + 'deg');
      window.setTimeout(function () {
        order.push(order.shift());
        layout();
        busy = false;
      }, reduce ? 0 : 320);
    }
    function next() { throwTop(1); }
    function prev() { if (busy) return; order.unshift(order.pop()); layout(); }
    function flip() { cards[order[0]].classList.toggle('is-flipped'); }

    var drag = null;
    stack.addEventListener('pointerdown', function (e) {
      var c = e.target.closest('.pc');
      if (busy || !c || c !== cards[order[0]] || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { c: c, x0: e.clientX, y0: e.clientY, dx: 0, t0: Date.now(), id: e.pointerId, moved: false };
    });
    stack.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.x0;
      var dy = e.clientY - drag.y0;
      if (!drag.moved && Math.abs(drag.dx) > 8 && Math.abs(drag.dx) > Math.abs(dy)) {
        drag.moved = true;
        drag.c.classList.add('is-dragging');
        try { stack.setPointerCapture(drag.id); } catch (err) { /* ignore */ }
      }
      if (drag.moved) {
        drag.c.style.setProperty('--x', drag.dx + 'px');
        drag.c.style.setProperty('--y', (dy * 0.25) + 'px');
        drag.c.style.setProperty('--r', (drag.dx * 0.05) + 'deg');
      }
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var d = drag;
      drag = null;
      d.c.classList.remove('is-dragging');
      if (d.moved && Math.abs(d.dx) > 90) throwTop(d.dx > 0 ? 1 : -1);
      else if (!d.moved && Date.now() - d.t0 < 400) flip();
      else layout();
    }
    stack.addEventListener('pointerup', end);
    stack.addEventListener('pointercancel', function () { if (drag) { drag.c.classList.remove('is-dragging'); drag = null; layout(); } });

    var nbtn = $('.js-next'), pbtn = $('.js-prev'), fbtn = $('.js-flip');
    if (nbtn) nbtn.addEventListener('click', next);
    if (pbtn) pbtn.addEventListener('click', prev);
    if (fbtn) fbtn.addEventListener('click', flip);
    stack.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });
    layout();
  }

  /* =====================================================================
   * Лайтбокс (нативний <dialog>)
   * ===================================================================== */
  function initLightbox() {
    var dlg = $('#lightbox');
    var links = $$('[data-lightbox]');
    if (!dlg || typeof dlg.showModal !== 'function' || !links.length) return;
    var img = $('.lb-img', dlg);
    var cap = $('.lb-cap', dlg);
    var group = [];
    var idx = 0;

    function show(i) {
      idx = (i + group.length) % group.length;
      var a = group[idx];
      var thumb = $('img', a);
      var alt = thumb ? thumb.getAttribute('alt') : '';
      img.src = a.getAttribute('href');
      img.alt = alt;
      cap.textContent = alt;
      var single = group.length < 2;
      $('.lb-prev', dlg).hidden = single;
      $('.lb-next', dlg).hidden = single;
    }
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var name = a.getAttribute('data-lightbox');
        group = links.filter(function (l) { return l.getAttribute('data-lightbox') === name; });
        show(group.indexOf(a));
        dlg.showModal();
        root.style.overflow = 'hidden';
        if (lenis) lenis.stop();
      });
    });
    $('.lb-close', dlg).addEventListener('click', function () { dlg.close(); });
    $('.lb-prev', dlg).addEventListener('click', function () { show(idx - 1); });
    $('.lb-next', dlg).addEventListener('click', function () { show(idx + 1); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    });
    dlg.addEventListener('close', function () { root.style.overflow = ''; if (lenis) lenis.start(); img.removeAttribute('src'); });
  }

  /* =====================================================================
   * Дрібниці: тост, копіювання, коти-пасхалки, пауза стрічки
   * ===================================================================== */
  var toastTimer = null;
  function toast(msg) {
    var el = $('.toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
      doc.body.appendChild(ta);
      ta.select();
      try { if (doc.execCommand('copy')) resolve(); else reject(); } catch (e) { reject(e); }
      doc.body.removeChild(ta);
    });
  }
  function initCopy() {
    $$('.js-copy').forEach(function (b) {
      b.addEventListener('click', function () {
        var text = b.getAttribute('data-copy') || '';
        copyText(text).then(function () { toast(t('ct.copied')); }, function () { toast(text); });
      });
    });
  }

  function initCats() {
    $$('.cat-medal').forEach(function (b) {
      var timer = null;
      b.addEventListener('click', function () {
        b.classList.add('is-purring');
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { b.classList.remove('is-purring'); }, 1600);
      });
    });

    var btn = $('.peek-btn');
    var bubble = $('.peek-bubble');
    var n = 0;
    var bt = null;
    if (btn && bubble) {
      btn.addEventListener('click', function () {
        n = (n % 3) + 1;
        bubble.textContent = t('footer.cat' + n);
        bubble.classList.add('is-on');
        window.clearTimeout(bt);
        bt = window.setTimeout(function () { bubble.classList.remove('is-on'); }, 3200);
      });
    }

    // Зіниці кота стежать за курсором (лише десктоп і без reduced motion)
    var pupils = $$('.cat-pupil');
    var svg = $('.peek-svg');
    if (!pupils.length || !svg || reduce || !(window.matchMedia && window.matchMedia('(pointer: fine)').matches)) return;
    var raf = null, mx = 0, my = 0;
    window.addEventListener('pointermove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        raf = null;
        var r = svg.getBoundingClientRect();
        if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
        var cx = r.left + r.width / 2, cy = r.top + r.height * 0.58;
        var ang = Math.atan2(my - cy, mx - cx);
        var dist = Math.min(1, Math.hypot(mx - cx, my - cy) / 300);
        var ox = Math.cos(ang) * 3.2 * dist, oy = Math.sin(ang) * 2.4 * dist;
        pupils.forEach(function (p) { p.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px)'; });
      });
    }, { passive: true });
  }

  function initRibbon() {
    var ribbon = $('.ribbon');
    var btn = $('.ribbon-toggle');
    if (!ribbon || !btn) return;
    btn.addEventListener('click', function () {
      var paused = !ribbon.classList.contains('is-paused');
      ribbon.classList.toggle('is-paused', paused);
      btn.setAttribute('aria-pressed', String(paused));
    });
  }

  /* =====================================================================
   * Оголошення з site-config.js (announcement)
   * ===================================================================== */
  function initNotice() {
    var el = $('#notice');
    var a = CFG.announcement;
    if (!el || !a || !((a.uk || '').trim() || (a.ru || '').trim())) return;
    if (a.until && /^\d{4}-\d{2}-\d{2}$/.test(a.until) && kyivDateStr() > a.until) return;
    var key = 'sh-notice-closed';
    var id = hash((a.uk || '') + '|' + (a.ru || ''));
    var textEl = $('.notice-text', el);
    function render() {
      var s = String(a[lang] || a.uk || a.ru || '').trim();
      if (!s || lsGet(key) === id) { el.hidden = true; return; }
      textEl.textContent = nb(s);
      el.hidden = false;
    }
    $('.notice-close', el).addEventListener('click', function () {
      lsSet(key, id);
      el.hidden = true;
      var m = doc.getElementById('main');
      if (m) m.focus({ preventScroll: true });
      if (hasGsap) window.ScrollTrigger.refresh();
    });
    onLang(render);
    render();
  }

  /* =====================================================================
   * «Записка Шарлотті Мойсеївні» — складає текст для бронювання.
   * Нічого нікуди не надсилає: текст можна скопіювати, продиктувати або вставити в месенджер.
   * ===================================================================== */
  function initBooking() {
    var wrap = $('#booking');
    if (!wrap) return;
    var body = $('.bk-body', wrap), form = $('.bk-form', wrap), fallback = $('.bk-fallback', wrap);
    var dateI = $('#bk-date'), timeS = $('#bk-time'), guestsI = $('#bk-guests'), nameI = $('#bk-name'), wishI = $('#bk-wishes');
    var noteEl = $('#bk-note-text'), hint = $('.bk-hint', wrap), copyBtn = $('.bk-copy', wrap);
    if (!body || !form || !dateI || !timeS || !guestsI || !noteEl) return;
    body.hidden = false;
    if (fallback) fallback.hidden = true;
    var hintKey = '';

    function addDays(str, n) {
      var p = str.split('-');
      var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
      return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    }
    function wdOf(str) { var p = str.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
    function validDate(str) { return /^\d{4}-\d{2}-\d{2}$/.test(str || ''); }
    function slots(str) {
      var h = hoursFor(wdOf(str));
      if (!h) return [];
      var out = [];
      for (var m = h.o; m <= h.c - 60; m += 30) out.push(m);
      return out;
    }
    /* Заповнює список часу; повертає true, якщо є хоч один доступний слот */
    function fillTimes() {
      var str = dateI.value;
      var list = slots(str);
      var isToday = str === kyivDateStr();
      var k = kyivNow(), now = k.h * 60 + k.m;
      var prev = timeS.value, firstOk = null, prevOk = false, sevenOk = false;
      timeS.innerHTML = '';
      list.forEach(function (m) {
        var o = doc.createElement('option');
        o.value = o.textContent = fmtTime(m);
        if (isToday && m < now + 30) o.disabled = true;
        else {
          if (firstOk === null) firstOk = o.value;
          if (o.value === prev) prevOk = true;
          if (o.value === '19:00') sevenOk = true;
        }
        timeS.appendChild(o);
      });
      if (firstOk === null) return false;
      timeS.value = prevOk ? prev : (sevenOk ? '19:00' : firstOk);
      return true;
    }
    /* Шукає найближчий день із вільним часом, починаючи зі start, і пояснює, чому дату змінено */
    function pickDate(start, reason) {
      for (var i = 0; i < 8; i++) {
        dateI.value = addDays(start, i);
        if (fillTimes()) {
          var openStart = !!hoursFor(wdOf(start));
          hintKey = !i ? '' : (reason === 'bk.late' && openStart) ? (i === 1 ? 'bk.late' : 'bk.lateNext') : 'bk.closedDay';
          return;
        }
      }
      hintKey = '';
    }
    function guests() {
      var n = parseInt(guestsI.value, 10);
      if (!isFinite(n) || n < 1) n = 1;
      if (n > 99) n = 99;
      return n;
    }
    function compose() {
      var str = dateI.value, today = kyivDateStr();
      var p = str.split('-');
      var dm = p[2] + '.' + p[1];
      try {
        dm = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' })
          .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)));
      } catch (e) { /* лишаємо ДД.ММ */ }
      var day = str === today ? t('bk.n.today') : (str === addDays(today, 1) ? t('bk.n.tomorrow') : t('dayAcc.' + wdOf(str)));
      var time = timeS.value;
      var n = guests();
      var occInput = form.querySelector('input[name="occ"]:checked');
      var occ = occInput ? occInput.value : 'dinner';
      var name = (nameI && nameI.value || '').trim();
      var wish = (wishI && wishI.value || '').trim();
      var lines = [
        t('bk.n.greet'),
        '',
        fill(t('bk.n.when'), { date: day + ', ' + dm, at: at(toMin(time) || 0), time: time }),
        fill(t('bk.n.table'), { n: n, persons: plural(n, 'plural.person') }),
        fill(t('bk.n.occ'), { occ: t('bk.no.' + occ) })
      ];
      if (wish) lines.push(fill(t('bk.n.wish'), { wish: wish }));
      lines.push(t('bk.n.ask'), '', name ? fill(t('bk.n.sign'), { name: name }) : t('bk.n.signAnon'));
      return lines.join('\n');
    }

    // Месенджери — лише ті, що вписані в site-config.js
    var M = CFG.messengers || {};
    var msgWrap = $('.bk-msgs', wrap), msgBtns = $('.bk-msg-btns', wrap);
    var msgs = [];
    function digits(s) { return String(s || '').replace(/\D/g, ''); }
    if (M.whatsapp && digits(M.whatsapp)) msgs.push({ label: 'WhatsApp', prefill: true, href: function (txt) { return 'https://wa.me/' + digits(M.whatsapp) + '?text=' + encodeURIComponent(txt); } });
    if (M.viber && digits(M.viber)) msgs.push({ label: 'Viber', href: function () { return 'viber://chat?number=' + encodeURIComponent('+' + digits(M.viber)); } });
    if (M.telegram && String(M.telegram).replace(/^@/, '').trim()) msgs.push({ label: 'Telegram', href: function () { return 'https://t.me/' + encodeURIComponent(String(M.telegram).replace(/^@/, '').trim()); } });
    if (msgs.length && msgWrap && msgBtns) {
      msgWrap.hidden = false;
      msgs.forEach(function (m) {
        var a = doc.createElement('a');
        a.className = 'btn btn--sm btn--ink-outline bk-msg';
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = icon('i-chat') + '<span>' + esc(m.label) + '</span>';
        a.addEventListener('click', function () {
          var txt = compose();
          a.setAttribute('href', m.href(txt));
          if (!m.prefill) copyText(txt).then(function () { toast(t('bk.msgCopied')); }, function () {});
        });
        m.el = a;
        msgBtns.appendChild(a);
      });
    }
    // Вступ: без JS форми немає, тож і вступ прихований; «чи в месенджері» — лише коли месенджери є
    var lead = $('.bk-lead', wrap);
    if (lead) {
      if (msgs.length) lead.setAttribute('data-i18n', 'bk.leadMsg');
      lead.textContent = nb(t(lead.getAttribute('data-i18n')));
      lead.hidden = false;
    }

    function render() {
      var txt = compose();
      // на екрані — з нерозривними пробілами («14 жовтня», «о 19:00»), копіюється — звичайний текст
      noteEl.textContent = nb(txt).replace(/(\d) (?=\S)/g, '$1' + String.fromCharCode(160));
      msgs.forEach(function (m) { m.el.setAttribute('href', m.href(txt)); });
      if (hint) hint.textContent = hintKey ? t(hintKey) : '';
    }

    var today = kyivDateStr();
    dateI.min = today;
    dateI.max = addDays(today, 365);
    pickDate(today, 'bk.late');
    var appliedDate = dateI.value;   // остання дата, для якої вже пораховано час і підказку

    function applyDate() {
      var tday = kyivDateStr();
      if (!validDate(dateI.value) || dateI.value < tday) dateI.value = tday;
      else if (dateI.max && dateI.value > dateI.max) dateI.value = dateI.max;   // рік, набраний із клавіатури, понад рік уперед
      var chosen = dateI.value;
      if (!fillTimes()) pickDate(chosen, chosen === tday ? 'bk.late' : 'bk.closedDay');
      else hintKey = '';
      appliedDate = dateI.value;
      render();
    }
    // Chrome шле 'change' після кожної набраної цифри (01.10, 07.10…) — проміжні дати в минулому не чіпаємо,
    // виправляємо їх лише при виході з поля
    dateI.addEventListener('change', function () {
      if (validDate(dateI.value) && dateI.value >= kyivDateStr()) applyDate();
    });
    dateI.addEventListener('blur', function () {
      if (dateI.value !== appliedDate || !validDate(dateI.value) || dateI.value < kyivDateStr()) applyDate();
    });

    // Хвилинний годинник (initClock): вкладка могла лишитися відкритою — минулий час чи вчорашня дата не повинні лишатися обраними
    var clockDay = today;
    bookingClock = function () {
      var tday = kyivDateStr();
      var dayChanged = tday !== clockDay;
      clockDay = tday;
      dateI.min = tday;
      dateI.max = addDays(tday, 365);
      if (dayChanged) hintKey = '';
      if (doc.activeElement === dateI || doc.activeElement === timeS) { if (dayChanged) render(); return; }
      if (validDate(dateI.value) && dateI.value > tday) { if (dayChanged) render(); return; }
      if (dateI.value !== tday) dateI.value = tday;
      if (!fillTimes()) pickDate(tday, 'bk.late');
      appliedDate = dateI.value;
      render();
    };
    function step(d) { guestsI.value = String(Math.min(99, Math.max(1, guests() + d))); render(); }
    var less = $('.bk-less', wrap), more = $('.bk-more', wrap);
    if (less) less.addEventListener('click', function () { step(-1); });
    if (more) more.addEventListener('click', function () { step(1); });
    guestsI.addEventListener('change', function () { guestsI.value = String(guests()); render(); });
    form.addEventListener('input', function (e) { if (e.target !== dateI) render(); });
    form.addEventListener('change', function (e) { if (e.target !== dateI) render(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    if (copyBtn) copyBtn.addEventListener('click', function () {
      var txt = compose();
      copyText(txt).then(function () { toast(t('bk.copied')); }, function () {
        try {   // запасний варіант: виділяємо текст записки, щоб скопіювати вручну
          var r = doc.createRange(); r.selectNodeContents(noteEl);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        } catch (e) { /* ignore */ }
        toast(t('bk.copyFail'));
      });
    });

    onLang(render);
    render();
  }

  /* =====================================================================
   * Пасхалка «З’їж шарлотку»: 8 шматочків, кожне натискання — мінус один
   * ===================================================================== */
  function initPie() {
    var pie = $('#pie');
    if (!pie) return;
    var btn = $('.pie-btn', pie), status = $('.pie-status', pie), end = $('.pie-end', pie), reset = $('.pie-reset', pie);
    var slices = $$('.pie-slice', pie);
    if (!btn || !slices.length || !status) return;
    pie.hidden = false;
    slices.forEach(function (s, i) { s.style.setProperty('--i', String(i)); });
    var eaten = 0, total = slices.length;

    function render() {
      var left = total - eaten;
      if (!eaten) status.textContent = t('pie.hint');
      else if (left === 1) status.textContent = t('pie.leftOne');
      else if (left) status.textContent = fill(t('pie.left'), { n: left, slices: plural(left, 'plural.slice') });
      else status.textContent = t('pie.done');
      if (end) end.hidden = left > 0;
      btn.disabled = left === 0;
      pie.classList.toggle('is-bitten', eaten > 0);
    }
    btn.addEventListener('click', function () {
      if (eaten >= total) return;
      pie.classList.remove('is-baking');
      slices[eaten].classList.add('is-eaten');
      eaten++;
      render();
      if (eaten === total && reset) reset.focus();
    });
    if (reset) reset.addEventListener('click', function () {
      eaten = 0;
      slices.forEach(function (s) { s.classList.remove('is-eaten'); });
      pie.classList.remove('is-baking'); void pie.offsetWidth; pie.classList.add('is-baking');
      render();
      status.textContent = t('pie.baked');
      btn.focus();
    });
    onLang(render);
    render();
  }

  /* =====================================================================
   * Старт: спершу все, що не залежить від CDN, потім — рух
   * ===================================================================== */
  function boot() {
    safe(initConfig, 'config');
    safe(initLang, 'lang');
    safe(initMenu, 'menu');
    safe(initSearch, 'search');
    safe(initReveal, 'reveal');
    safe(initHeader, 'header');
    safe(initToc, 'toc');
    safe(initAnchors, 'anchors');
    safe(initVb, 'vb');
    safe(initStack, 'stack');
    safe(initLightbox, 'lightbox');
    safe(initCopy, 'copy');
    safe(initCats, 'cats');
    safe(initRibbon, 'ribbon');
    safe(initNotice, 'notice');
    safe(initBooking, 'booking');
    safe(initPie, 'pie');
    safe(initClock, 'clock');
    window.SH_READY = true;
  }
  var motionStarted = false;
  function bootMotion() {
    if (motionStarted) return;
    motionStarted = true;
    hasGsap = !!(window.gsap && window.ScrollTrigger);
    safe(initSmooth, 'smooth');
    safe(initGsap, 'gsap');
  }

  if (doc.readyState === 'loading' && !doc.querySelector('#main')) doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  // Відкладені скрипти з CDN виконуються до DOMContentLoaded — тоді й запускаємо рух
  if (window.SH_DCL || doc.readyState === 'complete') bootMotion();
  else doc.addEventListener('DOMContentLoaded', bootMotion);
})();
