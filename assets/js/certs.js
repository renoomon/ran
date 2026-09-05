/* ============================================================
   certs.js — التصنيف العمري للأعمال
   TMDB يعطي التصنيف لكل دولة: أفلام عبر release_dates
   ومسلسلات عبر content_ratings. نحوّله لمستوى موحّد ٠..٥.
   ============================================================ */

(function (CS) {
  'use strict';

  /* ٠ عائلي · ١ إرشاد أبوي · ٢ +١٣ · ٣ +١٧ · ٤ +١٨ · ٥ إباحي صريح */
  var TIERS = [
    { n: 0, label: 'عائلي',    short: 'ع',    emoji: '🟢', color: '#3fbf7f' },
    { n: 1, label: 'إرشاد أبوي', short: 'PG',  emoji: '🟢', color: '#6cc27a' },
    { n: 2, label: '+13',      short: '13+',  emoji: '🟡', color: '#e6c455' },
    { n: 3, label: '+17',      short: '17+',  emoji: '🟠', color: '#e08b3f' },
    { n: 4, label: '+18',      short: '18+',  emoji: '🔴', color: '#e0523f' },
    { n: 5, label: 'إباحي صريح', short: '🔥',  emoji: '🔥', color: '#c2185b' }
  ];

  /* التصنيفات الحرفية المعروفة عبر الدول */
  var MAP = {
    /* أمريكا — أفلام ومسلسلات */
    'G': 0, 'TV-Y': 0, 'TV-Y7': 0, 'TV-G': 0,
    'PG': 1, 'TV-PG': 1,
    'PG-13': 2, 'TV-14': 2,
    'R': 3, 'TV-MA': 3,
    'NC-17': 4, 'AO': 4, '18+': 4,
    /* بريطانيا: 18 مقيّد للبالغين، R18 يُباع في محلات مرخّصة فقط ← إباحي */
    'U': 0, 'Uc': 0, '12A': 2, '12': 2, '15': 3, '18': 4, 'R18': 5,
    /* أستراليا: X 18+ إباحي صراحةً حسب تعريف TMDB */
    'M': 2, 'MA15+': 3, 'MA 15+': 3, 'R18+': 4, 'R 18+': 4,
    'X': 5, 'X18+': 5, 'X 18+': 5, 'RC': 4,
    /* فرنسا والبرازيل */
    'TP': 0, 'Livre': 0,
    /* أوروبا وغيرها — أرقام صافية */
    '0': 0, '6': 0, '7': 0, '9': 1, '10': 1, '11': 1,
    '13': 2, '14': 2, '16': 3, '17': 3
  };

  function tierFromCert(cert) {
    if (!cert) return null;
    var c = String(cert).trim().toUpperCase();
    if (MAP[c] !== undefined) return MAP[c];

    /* «PG13» أو «TV14» بدون شرطة */
    var squashed = c.replace(/[\s-]/g, '');
    var alt = Object.keys(MAP).filter(function (k) {
      return k.toUpperCase().replace(/[\s-]/g, '') === squashed;
    })[0];
    if (alt) return MAP[alt];

    /* رقم صافي مثل «١٦» أو «18» */
    var num = parseInt(c, 10);
    if (!isNaN(num)) {
      if (num >= 18) return 4;
      if (num >= 16) return 3;
      if (num >= 12) return 2;
      if (num >= 8) return 1;
      return 0;
    }
    return null;
  }

  function tierInfo(n) {
    return TIERS[Math.max(0, Math.min(5, n == null ? 2 : n))];
  }

  /* ---------- سحب التصنيف من TMDB ---------- */

  /* 'SA|movie:550' → { tier, cert, country }
     التصنيفات ما تتغير، فنخزّنها في المتصفح ونوفّر عشرات الطلبات كل زيارة */
  var CACHE_KEY = 'cs.cert_cache';
  var MAX_CACHE = 1500;

  var cache = (function () {
    var c = CS.store.get(CACHE_KEY, {});
    return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
  })();

  var pending = {};
  var saveTimer;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var keys = Object.keys(cache);
      if (keys.length > MAX_CACHE) {
        keys.slice(0, keys.length - MAX_CACHE).forEach(function (k) { delete cache[k]; });
      }
      CS.store.set(CACHE_KEY, cache);
    }, 800);
  }

  /* TMDB ما عنده تصنيفات للسعودية ولا الإمارات ولا مصر — تحققنا من قائمته.
     فنبدأ بمنطقة المستخدم (لو صادف عندها لوح) ثم دول عندها تصنيفات فعلًا. */
  function order() {
    var r = CS.state.region || 'SA';
    return [r, 'US', 'GB', 'AU', 'DE'].filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function fromMovie(json) {
    var results = (json || {}).results || [];
    var wanted = order();

    for (var i = 0; i < wanted.length; i++) {
      var block = results.filter(function (r) { return r.iso_3166_1 === wanted[i]; })[0];
      var cert = pickCert(block);
      if (cert) return { cert: cert, country: wanted[i] };
    }
    /* أي دولة فيها تصنيف */
    for (var j = 0; j < results.length; j++) {
      var any = pickCert(results[j]);
      if (any) return { cert: any, country: results[j].iso_3166_1 };
    }
    return null;
  }

  /* أنواع الإصدار عند TMDB: ٣ سينمائي · ٢ محدود · ٤ رقمي · ٥ مادي · ٦ تلفزيوني · ١ عرض أول.
     ترتيب المصفوفة غير مضمون، فناخذ التصنيف السينمائي أولًا لا الأول في القائمة. */
  var TYPE_PREF = [3, 2, 4, 5, 6, 1];

  function pickCert(block) {
    if (!block) return '';
    var dates = (block.release_dates || []).filter(function (d) {
      return (d.certification || '').trim();
    });
    if (!dates.length) return '';

    for (var i = 0; i < TYPE_PREF.length; i++) {
      var hit = dates.filter(function (d) { return d.type === TYPE_PREF[i]; })[0];
      if (hit) return hit.certification.trim();
    }
    return dates[0].certification.trim();
  }

  function fromTv(json) {
    var results = (json || {}).results || [];
    var wanted = order();
    for (var i = 0; i < wanted.length; i++) {
      var hit = results.filter(function (r) {
        return r.iso_3166_1 === wanted[i] && (r.rating || '').trim();
      })[0];
      if (hit) return { cert: hit.rating.trim(), country: wanted[i] };
    }
    var any = results.filter(function (r) { return (r.rating || '').trim(); })[0];
    return any ? { cert: any.rating.trim(), country: any.iso_3166_1 } : null;
  }

  /* يقرأ التصنيف من كائن التفاصيل الكامل (بدون طلب إضافي) */
  function fromDetails(raw, type, adult) {
    if (adult) return { tier: 5, cert: 'Adult', country: '' };
    var found = type === 'movie'
      ? fromMovie(raw.release_dates)
      : fromTv(raw.content_ratings);
    if (!found) return null;
    var tier = tierFromCert(found.cert);
    if (tier === null) return null;
    return { tier: tier, cert: found.cert, country: found.country };
  }

  /* يجيب التصنيف لعنصر من الشبكة (طلب خفيف واحد، مع تخزين) */
  function cacheKey(item) {
    return (CS.state.region || 'SA') + '|' + item.type + ':' + item.id;
  }

  function fetchFor(item) {
    if (!item || item.source !== 'tmdb') return Promise.resolve(null);
    if (item.adult) return Promise.resolve({ tier: 5, cert: 'Adult', country: '' });

    var k = cacheKey(item);
    if (cache[k] !== undefined) return Promise.resolve(cache[k]);
    if (pending[k]) return pending[k];

    var path = item.type === 'movie'
      ? '/movie/' + item.id + '/release_dates'
      : '/tv/' + item.id + '/content_ratings';

    pending[k] = CS.tmdb.req(path, { language: undefined })
      .then(function (json) {
        var found = item.type === 'movie' ? fromMovie(json) : fromTv(json);
        var out = null;
        if (found) {
          var tier = tierFromCert(found.cert);
          if (tier !== null) out = { tier: tier, cert: found.cert, country: found.country };
        }
        cache[k] = out;
        delete pending[k];
        persist();
        return out;
      })
      .catch(function () { cache[k] = null; delete pending[k]; persist(); return null; });

    return pending[k];
  }

  function cachedFor(item) {
    if (!item) return undefined;
    if (item.adult) return { tier: 5, cert: 'Adult', country: '' };
    if (item.certTier != null) return { tier: item.certTier, cert: item.cert || '', country: '' };
    return cache[cacheKey(item)];
  }

  function put(item, info) {
    cache[cacheKey(item)] = info;
    persist();
  }

  /* ---------- فلتر المستوى ---------- */

  /**
   * mature: هذا فلتر «للكبار فقط» — يعرض المستويات المحددة ولا شي غيرها،
   *         وأي عمل بلا تصنيف معروف يُستبعد (ما نبي محتوى عام يتسلل).
   * needsAdult: يحتاج موافقة صريحة قبل التفعيل.
   */
  var FILTERS = {
    all:    { label: 'كل التصنيفات', min: 0, max: 4 },
    family: { label: 'عائلي فقط',    min: 0, max: 1 },
    teen:   { label: '+13 وأقل',     min: 0, max: 2 },
    m17:    { label: '+17 فقط',      min: 3, max: 3, mature: true },
    m18:    { label: '+18 (NC-17 وما يعادله)', min: 4, max: 4, mature: true },
    adult:  { label: 'إباحي صريح فقط', min: 5, max: 5, mature: true, needsAdult: true }
  };

  function currentFilter() {
    var k = CS.store.get(CS.KEYS.certTier, 'all');
    return FILTERS[k] ? k : 'all';
  }

  function current() { return FILTERS[currentFilter()]; }

  /* المحتوى الإباحي يظهر فقط مع فلتر يطلبه + موافقة محفوظة */
  function adultAllowed() {
    var f = current();
    return !!(f.needsAdult && f.max === 5 && CS.store.get(CS.KEYS.adultOn, false) === true);
  }

  /* هل الفلتر الحالي «للكبار فقط»؟ يعني ما نعرض إلا المستويات المطلوبة */
  function matureOnly() { return !!current().mature; }

  /**
   * هل يعدّي العنصر الفلتر الحالي؟
   * ترجع true / false / null (null = التصنيف لسه ما وصل، انتظر)
   */
  function passes(item) {
    var key = currentFilter();
    var f = FILTERS[key];
    var info = cachedFor(item);

    /* الإباحي: يظهر فقط لو الفلتر يطلب المستوى ٥ والموافقة محفوظة */
    if (item && item.adult) return f.max === 5 && adultAllowed();

    if (key === 'all') return true;
    if (info === undefined) return null;          /* التصنيف لسه ما وصل */

    /* بلا تصنيف معروف = ما نعرفه. أي فلتر غير «الكل» يستبعده،
       وإلا يتسرّب محتوى غير مصنّف تحت «عائلي فقط» */
    if (info === null) return false;

    return info.tier >= f.min && info.tier <= f.max;
  }

  /* TMDB يقبل فلترة التصنيف في /discover للأفلام فقط، وبتصنيفات أمريكا */
  /* certification.lte وحده يسحب NR (الرتبة صفر) — أي غير المصنّف — فنحدّ الطرفين.
     ولا نضع تصنيفًا لوضع «الإباحي»: علم adult محور منفصل تمامًا عن NC-17،
     ولو فلترنا بـ NC-17 هناك رجعت أفلام عادية يرفضها passes() فتطلع النتيجة صفرًا. */
  var DISCOVER_CERT = {
    family: { 'certification.gte': 'G', 'certification.lte': 'PG' },
    teen:   { 'certification.gte': 'G', 'certification.lte': 'PG-13' },
    m17:    { certification: 'R' },
    m18:    { 'certification.gte': 'NC-17' }
  };

  function discoverCert(type) {
    if (type !== 'movie') return null;
    var map = DISCOVER_CERT[currentFilter()];
    if (!map) return null;
    var out = { certification_country: 'US' };
    Object.keys(map).forEach(function (k) { out[k] = map[k]; });
    return out;
  }

  CS.certs = {
    TIERS: TIERS,
    discoverCert: discoverCert,
    matureOnly: matureOnly,
    current: current,
    FILTERS: FILTERS,
    tierFromCert: tierFromCert,
    tierInfo: tierInfo,
    fromDetails: fromDetails,
    fetchFor: fetchFor,
    cachedFor: cachedFor,
    put: put,
    currentFilter: currentFilter,
    adultAllowed: adultAllowed,
    passes: passes
  };

})(window.CS);
