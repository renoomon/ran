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
    /* أمريكا — أفلام */
    'G': 0, 'TV-Y': 0, 'TV-Y7': 0, 'TV-G': 0,
    'PG': 1, 'TV-PG': 1,
    'PG-13': 2, 'TV-14': 2,
    'R': 3, 'TV-MA': 3, 'MA15+': 3,
    'NC-17': 4, 'X': 4, 'R18+': 4, 'R18': 4, 'AO': 4, '18+': 4,
    /* بريطانيا */
    'U': 0, 'Uc': 0, '12A': 2, '12': 2, '15': 3, '18': 4,
    /* أوروبا وغيرها */
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

  var cache = {};   /* 'movie:550' → { tier, cert, country } */
  var pending = {};

  function order() {
    var r = CS.state.region || 'SA';
    return [r, 'SA', 'AE', 'EG', 'US', 'GB'].filter(function (v, i, a) { return a.indexOf(v) === i; });
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

  function pickCert(block) {
    if (!block) return '';
    var dates = block.release_dates || [];
    for (var i = 0; i < dates.length; i++) {
      if ((dates[i].certification || '').trim()) return dates[i].certification.trim();
    }
    return '';
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
  function fetchFor(item) {
    if (!item || item.source !== 'tmdb') return Promise.resolve(null);
    if (item.adult) return Promise.resolve({ tier: 5, cert: 'Adult', country: '' });

    var k = item.type + ':' + item.id;
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
        return out;
      })
      .catch(function () { cache[k] = null; delete pending[k]; return null; });

    return pending[k];
  }

  function cachedFor(item) {
    if (!item) return undefined;
    if (item.adult) return { tier: 5, cert: 'Adult', country: '' };
    if (item.certTier != null) return { tier: item.certTier, cert: item.cert || '', country: '' };
    return cache[item.type + ':' + item.id];
  }

  function put(item, info) {
    cache[item.type + ':' + item.id] = info;
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
    m18:    { label: '+18 فما فوق',  min: 4, max: 5, mature: true, needsAdult: true },
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

    /* بلا تصنيف معروف: في وضع «للكبار فقط» نستبعده حتى ما يتسرّب محتوى عام */
    if (info === null) return f.mature ? false : true;

    return info.tier >= f.min && info.tier <= f.max;
  }

  /* TMDB يقبل فلترة التصنيف في /discover للأفلام فقط، وبتصنيفات أمريكا */
  var DISCOVER_CERT = {
    family: { 'certification.lte': 'PG' },
    teen:   { 'certification.lte': 'PG-13' },
    m17:    { certification: 'R' },
    m18:    { certification: 'NC-17' },
    adult:  { certification: 'NC-17' }
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
