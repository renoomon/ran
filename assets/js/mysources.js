/* ============================================================
   mysources.js — مدير مصادر المشاهدة الخاصة بالمشغّل
   يضيف صاحب الموقع سيرفراته الرسمية هنا، والموقع يبني منها
   روابط المشاهدة لكل عمل. المسؤولية عن شرعية أي مصدر تُضاف
   على من يضيفه.
   ============================================================ */

(function (CS) {
  'use strict';

  /* القوالب تدعم هذي البدائل */
  var TOKENS = ['{title}', '{title_raw}', '{year}', '{imdb}', '{tmdb}', '{type}', '{season}', '{episode}', '{key}'];

  var TYPES = {
    embed: 'مشغّل داخل الصفحة (iframe)',
    link:  'رابط يفتح في تبويب جديد',
    api:   'API يرجّع JSON فيه رابط التشغيل'
  };

  function all() {
    var list = CS.store.get(CS.KEYS.sources, []);
    return Array.isArray(list) ? list : [];
  }

  function save(list) {
    CS.store.set(CS.KEYS.sources, list.slice(0, 40));
    return list;
  }

  /* يستنتج اسم الموقع من الرابط لو ما كتب المستخدم اسمًا */
  function nameFromUrl(url) {
    try {
      var h = new URL(String(url).replace(/\{[^}]*\}/g, 'x')).hostname;
      return h.replace(/^www\./, '');
    } catch (e) { return ''; }
  }

  function add(src) {
    var url = String(src.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('BAD_URL');

    var list = all();
    var item = {
      id: 's' + Date.now() + Math.floor(Math.random() * 1000),
      name: String(src.name || '').trim() || nameFromUrl(url) || 'مصدر',
      url: url,
      key: String(src.key || '').trim(),
      type: TYPES[src.type] ? src.type : 'embed',
      enabled: true,
      status: null,          /* { ok, detail, at } */
      addedAt: Date.now()
    };
    list.push(item);
    save(list);
    return item;
  }

  function update(id, patch) {
    var list = all();
    list.forEach(function (s) { if (s.id === id) Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); });
    save(list);
  }

  function remove(id) {
    save(all().filter(function (s) { return s.id !== id; }));
  }

  /* ---------- بناء الرابط لعمل معيّن ---------- */

  function fill(tpl, item, extra) {
    extra = extra || {};
    var name = item.originalTitle || item.title || '';
    var map = {
      '{title}':     encodeURIComponent(name),
      '{title_raw}': name,
      '{year}':      item.year || '',
      '{imdb}':      item.imdbId || '',
      '{tmdb}':      item.source === 'tmdb' ? item.id : '',
      '{type}':      item.type === 'tv' ? 'tv' : 'movie',
      '{season}':    extra.season || 1,
      '{episode}':   extra.episode || 1,
      '{key}':       encodeURIComponent(extra.key || '')
    };
    return String(tpl).replace(/\{[a-z_]+\}/g, function (t) {
      return map[t] !== undefined ? String(map[t]) : t;
    });
  }

  function urlFor(src, item, extra) {
    var e = Object.assign({ key: src.key }, extra || {});
    return fill(src.url, item, e);
  }

  /* هل القالب يقدر يشتغل لهذا العمل؟ (مثلًا يحتاج IMDb وما عندنا) */
  function missingFor(src, item) {
    var need = [];
    if (/\{imdb\}/.test(src.url) && !item.imdbId) need.push('معرّف IMDb');
    if (/\{tmdb\}/.test(src.url) && item.source !== 'tmdb') need.push('معرّف TMDB');
    return need;
  }

  /* ---------- التحقق ---------- */

  /* عمل تجريبي معروف نختبر فيه المصدر */
  var PROBE = {
    id: 27205, type: 'movie', title: 'Inception', originalTitle: 'Inception',
    year: 2010, imdbId: 'tt1375666', source: 'tmdb'
  };

  /**
   * يتحقق من المصدر ويرجّع { ok, detail }.
   * المتصفح ما يقدر يقرأ رد نطاق ثاني إلا لو أرسل ترويسات CORS،
   * فنقول الحقيقة: «وصلت» أو «ما قدرت أتحقق من المتصفح».
   */
  function test(src) {
    var url = urlFor(src, PROBE);
    var started = Date.now();

    if (src.type === 'link') {
      return Promise.resolve(mark(src, true, 'رابط جاهز — يفتح في تبويب جديد: ' + short(url)));
    }

    if (src.type === 'embed') {
      /* نتأكد إن الصفحة تُحمَّل داخل iframe فعلًا */
      return probeFrame(url).then(function (r) {
        return mark(src, r.ok, r.detail + ' (' + (Date.now() - started) + ' مللي)');
      });
    }

    /* api: نطلب JSON ونشوف إذا فيه رابط تشغيل */
    var headers = { accept: 'application/json' };
    if (src.key) headers.Authorization = 'Bearer ' + src.key;

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (!res.ok) return mark(src, false, 'المصدر رد بخطأ ' + res.status);
        return res.json().then(function (j) {
          var link = pickStream(j);
          return mark(src, !!link, link
            ? 'رجّع رابط تشغيل: ' + short(link)
            : 'رد بنجاح لكن ما لقيت فيه رابط تشغيل (نتوقّع حقل url أو stream أو link)');
        });
      })
      .catch(function (err) {
        var m = String(err && err.message || err);
        return mark(src, false, /Failed to fetch|NetworkError|Load failed/i.test(m)
          ? 'ما وصلت للمصدر — إما مقفول، أو ما يرسل ترويسات CORS للمتصفح'
          : m);
      });
  }

  /* يحمّل الرابط في iframe مخفي ويشوف إذا انفتح ولا انرفض */
  function probeFrame(url) {
    return new Promise(function (resolve) {
      var fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px';
      fr.setAttribute('aria-hidden', 'true');
      var done = false;

      var timer = setTimeout(function () {
        finish(false, 'ما رد خلال ٨ ثوانٍ — غالبًا يمنع التضمين (X-Frame-Options)');
      }, 8000);

      fr.onload = function () { finish(true, 'انفتح داخل الصفحة بنجاح'); };
      fr.onerror = function () { finish(false, 'رفض التحميل'); };

      function finish(ok, detail) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { document.body.removeChild(fr); } catch (e) { /* أُزيل مسبقًا */ }
        resolve({ ok: ok, detail: detail });
      }

      fr.src = url;
      document.body.appendChild(fr);
    });
  }

  function pickStream(j) {
    if (!j || typeof j !== 'object') return '';
    var keys = ['url', 'stream', 'link', 'src', 'file', 'playback_url', 'hls', 'embed'];
    for (var i = 0; i < keys.length; i++) {
      if (typeof j[keys[i]] === 'string' && /^https?:/.test(j[keys[i]])) return j[keys[i]];
    }
    /* أحيانًا يجي داخل data أو sources[0] */
    if (j.data) return pickStream(j.data);
    if (Array.isArray(j.sources) && j.sources.length) return pickStream(j.sources[0]);
    if (Array.isArray(j.results) && j.results.length) return pickStream(j.results[0]);
    return '';
  }

  function short(u) { return String(u).length > 70 ? String(u).slice(0, 70) + '…' : String(u); }

  function mark(src, ok, detail) {
    var res = { ok: ok, detail: detail, at: Date.now() };
    if (src.id) update(src.id, { status: res });
    return res;
  }

  /* يجيب رابط التشغيل الفعلي من مصدر api */
  function resolveApi(src, item) {
    var headers = { accept: 'application/json' };
    if (src.key) headers.Authorization = 'Bearer ' + src.key;
    return fetch(urlFor(src, item), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(pickStream)
      .catch(function () { return ''; });
  }

  CS.mySources = {
    TYPES: TYPES,
    TOKENS: TOKENS,
    all: all,
    add: add,
    update: update,
    remove: remove,
    urlFor: urlFor,
    missingFor: missingFor,
    test: test,
    resolveApi: resolveApi,
    nameFromUrl: nameFromUrl
  };

})(window.CS);
