/* ============================================================
   mysources.js — مدير مصادر المشاهدة الخاصة بالمشغّل

   الحالة الأساسية: تلصق رابط الموقع فقط — «https://example.com/» —
   والموقع يبني بنفسه رابط البحث داخله عن كل عمل بالاسم والسنة.
   ما فيه مفتاح API ولا قوالب إلزامية.

   الحالات المتقدّمة (قوالب، مشغّل مباشر، API) باقية لمن يحتاجها.
   المسؤولية عن شرعية أي مصدر تُضاف على من يضيفه.
   ============================================================ */

(function (CS) {
  'use strict';

  /* القوالب تدعم هذي البدائل */
  var TOKENS = ['{title}', '{title_raw}', '{year}', '{imdb}', '{tmdb}', '{type}', '{season}', '{episode}', '{key}'];

  var TYPES = {
    site:  'موقع كامل — يبحث فيه بالاسم',
    video: 'ملف فيديو مباشر (MP4 أو HLS)',
    embed: 'مشغّل داخل الصفحة (iframe)',
    link:  'رابط يفتح في تبويب جديد',
    api:   'API يرجّع JSON فيه رابط التشغيل'
  };

  /* ملف وسائط مباشر: <video> يشغّله بلا أي ترويسات CORS —
     التقييد على قراءة الجافاسكربت للبايتات، لا على تشغيل الوسائط.
     HLS استثناء: سفاري يشغّله أصلًا، وباقي المتصفحات تحتاج hls.js وترويسات CORS. */
  var MEDIA_RE = /\.(mp4|m4v|webm|ogv|mov|m3u8|mpd)(\?|#|$)/i;

  function isMediaUrl(url) { return MEDIA_RE.test(String(url || '')); }
  function isHls(url) { return /\.m3u8(\?|#|$)/i.test(String(url || '')); }

  /* ------------------------------------------------------------
     أنماط البحث داخل المواقع
     الموقع يبني رابط البحث من نمط، والافتراضي هو الأشيع فعلًا
     (ووردبريس وقوالب الفيديو المبنية عليه تستخدم ?s=)
     ------------------------------------------------------------ */

  var PATTERNS = [
    { id: 's',      label: '?s=  (ووردبريس — الأشيع)',   tpl: '{origin}/?s={title}' },
    { id: 'searchq', label: '/search?q=',                 tpl: '{origin}/search?q={title}' },
    { id: 'searchp', label: '/search/الاسم',              tpl: '{origin}/search/{title}' },
    { id: 'q',       label: '/?q=',                       tpl: '{origin}/?q={title}' },
    { id: 'findq',   label: '/find?q=',                   tpl: '{origin}/find?q={title}' },
    { id: 'query',   label: '/?query=',                   tpl: '{origin}/?query={title}' },
    { id: 'keyword', label: '/?keyword=',                 tpl: '{origin}/?keyword={title}' },
    { id: 'dooplay', label: '?s= مع أفلام فقط (DooPlay)',  tpl: '{origin}/?s={title}&post_type=movies' },
    { id: 'maccms',  label: 'MacCMS / 苹果CMS',             tpl: '{origin}/index.php/vod/search.html?wd={title}' },
    { id: 'drupal',  label: 'دروبال /search/node',         tpl: '{origin}/search/node?keys={title}' }
  ];

  function patternById(id) {
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].id === id) return PATTERNS[i];
    return PATTERNS[0];
  }

  /* مواقع معروفة رابط بحثها موثّق — تُضبط تلقائيًا لما تلصق نطاقها */
  var KNOWN = {
    'netflix.com':        { pattern: 'custom', tpl: 'https://www.netflix.com/search?q={title}' },
    'primevideo.com':     { pattern: 'custom', tpl: 'https://www.primevideo.com/search/ref=atv_nb_sug?phrase={title}' },
    'disneyplus.com':     { pattern: 'custom', tpl: 'https://www.disneyplus.com/search?q={title}' },
    'tv.apple.com':       { pattern: 'custom', tpl: 'https://tv.apple.com/search?term={title}' },
    'youtube.com':        { pattern: 'custom', tpl: 'https://www.youtube.com/results?search_query={title}' },
    /* الخدمات العربية تحتاج مقطع اللغة في المسار */
    'shahid.mbc.net':     { pattern: 'custom', tpl: 'https://shahid.mbc.net/ar/search?q={title}' },
    'starzplay.com':      { pattern: 'custom', tpl: 'https://www.starzplay.com/ar/search?q={title}' },
    'osnplus.com':        { pattern: 'custom', tpl: 'https://osnplus.com/ar-sa/search?q={title}' },
    'viu.com':            { pattern: 'custom', tpl: 'https://www.viu.com/ott/sa/ar/search?q={title}' },
    'watchit.com':        { pattern: 'custom', tpl: 'https://www.watchit.com/search?q={title}' },
    'letterboxd.com':     { pattern: 'custom', tpl: 'https://letterboxd.com/search/{title}/' },
    'rottentomatoes.com': { pattern: 'custom', tpl: 'https://www.rottentomatoes.com/search?search={title}' },
    'justwatch.com':      { pattern: 'custom', tpl: 'https://www.justwatch.com/sa/search?q={title}' },
    'imdb.com':           { pattern: 'custom', tpl: 'https://www.imdb.com/find/?q={title}&s=tt' },
    'google.com':         { pattern: 'custom', tpl: 'https://www.google.com/search?q={title}' },
    'bing.com':           { pattern: 'custom', tpl: 'https://www.bing.com/search?q={title}' },
    'yandex.com':         { pattern: 'custom', tpl: 'https://yandex.com/search/?text={title}' },
    'duckduckgo.com':     { pattern: 'custom', tpl: 'https://duckduckgo.com/?q={title}' }
  };

  function knownFor(host) {
    var h = String(host || '').replace(/^www\./, '');
    if (KNOWN[h]) return KNOWN[h];
    /* نطاق فرعي لموقع معروف */
    var keys = Object.keys(KNOWN);
    for (var i = 0; i < keys.length; i++) {
      if (h === keys[i] || h.slice(-(keys[i].length + 1)) === '.' + keys[i]) return KNOWN[keys[i]];
    }
    return null;
  }

  /* ------------------------------------------------------------
     التخزين
     ------------------------------------------------------------ */

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
    return hostOf(url).replace(/^www\./, '');
  }

  function hostOf(url) {
    try { return new URL(normalize(url)).hostname; }
    catch (e) { return ''; }
  }

  function originOf(url) {
    try { return new URL(normalize(url)).origin; }
    catch (e) { return ''; }
  }

  /* يقبل «example.com» بدون بروتوكول ويكمّله، ويشيل البدائل من الفحص */
  function normalize(url) {
    var u = String(url || '').trim().replace(/\{[^}]*\}/g, 'x');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  /* هل الرابط قالب فيه بدائل، ولا مجرد نطاق؟ */
  function hasTokens(url) { return /\{[a-z_]+\}/.test(String(url || '')); }

  /* النوع اللي يناسب الرابط اللي لصقه المستخدم */
  function guessType(url) {
    if (isMediaUrl(url)) return 'video';
    if (!hasTokens(url)) return 'site';
    if (/\/api\/|\/api\?|\.json|format=json/i.test(url)) return 'api';
    return 'embed';
  }

  /**
   * يتعلّم القالب من مثال بدل ما يخمّن:
   * تلصق رابط بحث حقيقي من موقعك — https://site.com/?s=inception —
   * ونستبدل قيمة البحث بـ{title} فيصير القالب مضبوطًا مئة بالمئة.
   * هذا الحل الوحيد الأكيد: المتصفح ما يقدر يكتشف نمط أي موقع عن بُعد.
   */
  function learnTemplate(url) {
    var u;
    try { u = new URL(normalize(url)); } catch (e) { return ''; }

    /* ١) قيمة في الاستعلام — الحالة الأشيع (?s= ?q= ?wd= ?phrase=) */
    var key = '';
    u.searchParams.forEach(function (v, k) {
      if (!key && v && v.length >= 2 && !/^\d+$/.test(v)) key = k;
    });
    if (key) {
      u.searchParams.set(key, 'RANHUBTITLE');
      return u.toString().replace('RANHUBTITLE', '{title}');
    }

    /* ٢) آخر مقطع في مسار بحث — /search/inception أو /find/inception/ */
    var m = u.pathname.match(/^(.*\/(?:search|find|s|q|vod|بحث)\/)([^\/]{2,})(\/?)$/i);
    if (m) return u.origin + m[1] + '{title}' + m[3] + u.search + u.hash;

    return '';
  }

  /* النمط اللي يناسب النطاق */
  function guessPattern(url) {
    var k = knownFor(hostOf(url));
    return k ? k.pattern : 's';
  }

  function add(src) {
    var raw = String(src.url || '').trim();
    var url = normalize(raw);
    if (!url || !hostOf(url)) throw new Error('BAD_URL');

    /* لو ما فيه بدائل نحتفظ بالنطاق فقط ونبني البحث من النمط */
    var type = TYPES[src.type] ? src.type : guessType(raw);
    var known = knownFor(hostOf(url));
    /* لصق مثال بحث حقيقي؟ نتعلّم منه القالب ونتجاهل الأنماط المخمَّنة */
    var learned = type === 'site' ? learnTemplate(raw) : '';

    var item = {
      id: 's' + Date.now() + Math.floor(Math.random() * 1000),
      name: String(src.name || '').trim() || nameFromUrl(url) || 'مصدر',
      /* نحتفظ بالمثال اللي لصقه عشان يشوفه في القائمة */
      example: learned ? raw : '',
      /* «موقع كامل» وحده يُختزل لنطاقه — غيره يحتفظ بالمسار كما هو،
         وإلا ضاع مسار ملف الفيديو أو القالب */
      url: type === 'site' && !hasTokens(raw) ? originOf(url) : url,
      learned: !!learned,
      origin: originOf(url),
      key: String(src.key || '').trim(),
      type: type,
      pattern: learned ? 'custom' : (src.pattern || (known ? known.pattern : 's')),
      tpl: learned || (known ? known.tpl : ''),
      enabled: true,
      status: null,          /* { ok, detail, at } */
      addedAt: Date.now()
    };

    /* نمط مخصّص كتبه المستخدم بنفسه يغلب كل شي */
    if (src.pattern === 'custom' && src.tpl) { item.tpl = String(src.tpl).trim(); item.learned = false; }

    var list = all();
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

  function byId(id) {
    return all().filter(function (s) { return s.id === id; })[0] || null;
  }

  /* ------------------------------------------------------------
     بناء الرابط لعمل معيّن
     ------------------------------------------------------------ */

  /* المسافات: '+' داخل الاستعلام و%20 داخل المسار — الخلط يكسر بحث بعض المواقع */
  function encTitle(name, tpl) {
    var enc = encodeURIComponent(name);
    var at = String(tpl).indexOf('{title}');
    var qm = String(tpl).indexOf('?');
    var inQuery = qm !== -1 && at > qm;
    return inQuery ? enc.replace(/%20/g, '+') : enc;
  }

  function fill(tpl, item, extra) {
    extra = extra || {};
    var name = item.originalTitle || item.title || '';
    var map = {
      '{title}':     encTitle(name, tpl),
      '{title_raw}': name,
      '{year}':      item.year || '',
      '{imdb}':      item.imdbId || '',
      '{tmdb}':      item.source === 'tmdb' ? item.id : '',
      '{type}':      item.type === 'tv' ? 'tv' : 'movie',
      '{season}':    extra.season || 1,
      '{episode}':   extra.episode || 1,
      '{key}':       encodeURIComponent(extra.key || ''),
      '{origin}':    extra.origin || ''
    };
    return String(tpl).replace(/\{[a-z_]+\}/g, function (t) {
      return map[t] !== undefined ? String(map[t]) : t;
    });
  }

  /* نص البحث: الاسم الأصلي أدق داخل المواقع الأجنبية، والسنة تضيّق النتيجة */
  function searchTerm(item) {
    var name = item.originalTitle || item.title || '';
    return item.year ? name + ' ' + item.year : name;
  }

  function urlFor(src, item, extra) {
    var e = Object.assign({ key: src.key, origin: src.origin || originOf(src.url) }, extra || {});

    if (src.type === 'site') {
      var tpl = src.tpl || patternById(src.pattern).tpl;
      var probe = { originalTitle: searchTerm(item), title: searchTerm(item), year: '', type: item.type };
      return fill(tpl, probe, e);
    }

    return fill(src.url, item, e);
  }

  /* هل القالب يقدر يشتغل لهذا العمل؟ (مثلًا يحتاج IMDb وما عندنا) */
  function missingFor(src, item) {
    if (src.type === 'site') return [];
    var need = [];
    if (/\{imdb\}/.test(src.url) && !item.imdbId) need.push('معرّف IMDb');
    if (/\{tmdb\}/.test(src.url) && item.source !== 'tmdb') need.push('معرّف TMDB');
    return need;
  }

  /* ------------------------------------------------------------
     التحقق
     ------------------------------------------------------------ */

  /* عمل تجريبي معروف نختبر فيه المصدر */
  var PROBE = {
    id: 27205, type: 'movie', title: 'Inception', originalTitle: 'Inception',
    year: 2010, imdbId: 'tt1375666', source: 'tmdb'
  };

  /**
   * يتحقق من المصدر ويرجّع { ok, detail }.
   *
   * حدود المتصفح — مقيسة لا مفترضة:
   *  · fetch عادي لنطاق ثاني محجوب إلا لو أرسل ترويسات CORS.
   *  · fetch بـ mode:'no-cors' يرجّع ردًّا معتمًا: ما نقرأ محتواه ولا حالته،
   *    لكن نجاحه من فشله يفرّق «النطاق موجود ووصلته» عن «ما وصلته». نستخدم هذا.
   *  · تحميل الموقع في iframe ما يفرّق شي: قِسنا الحالات الأربع
   *    (نجاح · X-Frame-Options · frame-ancestors · نطاق ميت) فطلعت كلها متطابقة —
   *    onload ينطلق في الأربع، وcontentDocument = null، وlocation ترمي SecurityError.
   *    فما نقدر نعرف هل الموقع يقبل العرض داخل الصفحة إلا لما تفتحه بعينك،
   *    وما نكذب ونقول «انفتح بنجاح».
   */
  function test(src) {
    var url = urlFor(src, PROBE);
    var started = Date.now();

    if (src.type === 'link') {
      return Promise.resolve(mark(src, true, 'رابط جاهز — يفتح في تبويب جديد: ' + short(url)));
    }

    if (src.type === 'video') {
      /* ما نتحقق بـfetch — العنصر <video> نفسه هو الحكم، وهو ما يحتاج CORS */
      return probeMedia(url).then(function (r) {
        return mark(src, r.ok, r.detail + ' (' + (Date.now() - started) + ' مللي)');
      });
    }

    if (src.type === 'site' || src.type === 'embed') {
      return reachable(url).then(function (r) {
        var ms = ' (' + (Date.now() - started) + ' مللي)';
        if (r.ok !== true) return mark(src, r.ok, r.detail + ms);
        return mark(src, true,
          'النطاق شغّال ووصلته' + ms +
          ' · يظهر داخل الصفحة ولا يحتاج تبويب؟ يبيّن أول ما تفتح عملًا.');
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

  /**
   * هل النطاق موجود ووصلته؟
   * الرد المعتم ما نقرأ منه شي، لكن مجرد نجاحه يثبت إن الطلب وصل وردّ.
   * الفشل يعني نطاق غلط أو مقفول أو الشبكة تحجبه.
   */
  function reachable(url) {
    return fetch(url, { mode: 'no-cors', redirect: 'follow', cache: 'no-store' })
      .then(function () { return { ok: true, detail: '' }; })
      .catch(function (err) {
        var m = String(err && err.message || err);
        /* فشل الطلب المعتم ما يثبت إن الموقع خربان.
           أسباب شائعة تُفشّل الفحص والموقع نفسه شغّال تمامًا:
           مانع الإعلانات يحجب طلبات fetch لهذا النطاق دون تصفّحه،
           وحماية كلاودفلير ترفض الطلبات غير الملاحية،
           وبعض السيرفرات ترفض Sec-Fetch-Mode: no-cors من أصل غريب.
           فنرجّع «غير حاسم» لا «فاشل» — والحكم للمستخدم بضغطة على الرابط. */
        return {
          ok: null,
          detail: /Failed to fetch|NetworkError|Load failed/i.test(m)
            ? 'ما قدرت أفحصه من المتصفح — وهذا ما يعني إنه خربان. ' +
              'الأغلب مانع إعلانات أو حماية الموقع تحجب طلب الفحص وحده. ' +
              'افتح رابط البحث تحت: إذا فتح عندك فالمصدر شغّال واتركه'
            : m
        };
      });
  }

  /**
   * يجرّب تشغيل الملف فعليًا في عنصر <video> مخفي.
   * هذا فحص حقيقي: loadedmetadata يعني المتصفح فتح الملف وقرأ مدته.
   * HLS في غير سفاري ما يشتغل أصلًا بلا hls.js، فنقول له كذا بصراحة.
   */
  function probeMedia(url) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');

      if (isHls(url) && !v.canPlayType('application/vnd.apple.mpegurl')) {
        resolve({ ok: true, detail: 'ملف HLS — متصفحك ما يشغّله أصلًا، ' +
          'فالموقع بيحمّل مشغّل hls.js وقت التشغيل. يحتاج سيرفرك يرسل ترويسات CORS' });
        return;
      }

      v.preload = 'metadata';
      v.muted = true;
      v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;top:-9999px';
      var done = false;

      var timer = setTimeout(function () { finish(false, 'ما رد خلال ١٢ ثانية'); }, 12000);

      v.onloadedmetadata = function () {
        finish(true, 'شغّال — فتح الملف' +
          (isFinite(v.duration) && v.duration ? ' ومدته ' + Math.round(v.duration / 60) + ' دقيقة' : ''));
      };
      v.onerror = function () {
        var e = v.error || {};
        finish(false, e.code === 4 ? 'الملف مو مدعوم أو الرابط غلط'
                    : e.code === 2 ? 'انقطعت الشبكة قبل ما يفتح'
                    : 'ما قدر يفتح الملف' + (e.message ? ' — ' + e.message : ''));
      };

      function finish(ok, detail) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { v.src = ''; document.body.removeChild(v); } catch (e) { /* أُزيل */ }
        resolve({ ok: ok, detail: detail });
      }

      v.src = url;
      document.body.appendChild(v);
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
    reachable: reachable,
    isMediaUrl: isMediaUrl,
    isHls: isHls,
    TOKENS: TOKENS,
    PATTERNS: PATTERNS,
    all: all,
    byId: byId,
    add: add,
    update: update,
    remove: remove,
    urlFor: urlFor,
    searchTerm: searchTerm,
    missingFor: missingFor,
    test: test,
    resolveApi: resolveApi,
    nameFromUrl: nameFromUrl,
    hostOf: hostOf,
    originOf: originOf,
    hasTokens: hasTokens,
    learnTemplate: learnTemplate,
    guessType: guessType,
    guessPattern: guessPattern,
    knownFor: knownFor,
    patternById: patternById
  };

})(window.CS);
