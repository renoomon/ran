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
    all:      { label: 'كل التصنيفات', min: 0, max: 4 },
    /* ثلاثة أقسام للكبار فقط — كلها تستبعد أي عمل غير مصنّف صراحةً */
    /* وضع «للبالغين فقط» على مستوى الموقع كله: R / TV-MA / 15 / 18 / NC-17.
       حصره في المستوى ٤ وحده يفرّغ الكتالوج — NC-17 كله بضع عشرات الأفلام. */
    adults:   { label: 'للبالغين فقط (+17 فما فوق)', min: 3, max: 4, mature: true, needsAdult: true },
    mature:   { label: '+18 (تصنيف رسمي)', min: 4, max: 4, mature: true, needsAdult: true },
    erotic:   { label: 'إيروتيك', min: 3, max: 4, mature: true, needsAdult: true, keywords: true },
    explicit: { label: 'إباحي صريح', min: 5, max: 5, mature: true, needsAdult: true }
  };

  function currentFilter() {
    var k = CS.store.get(CS.KEYS.certTier, 'all');
    return FILTERS[k] ? k : 'all';
  }

  function current() { return FILTERS[currentFilter()]; }

  /* كل أقسام الكبار الثلاثة تفتح include_adult — بموافقة محفوظة.
     ربطها بالمستوى ٥ وحده كان يقفل الإيروتيك و+18 بلا سبب. */
  function adultAllowed() {
    return !!(current().needsAdult && CS.store.get(CS.KEYS.adultOn, false) === true);
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
    /* العمل المعلَّم adult يظهر في أي قسم كبار مفتوح، لا في المستوى ٥ وحده */
    if (item && item.adult) return !!f.needsAdult && adultAllowed();

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
    /* +18 الرسمي: NC-17 فما فوق حسب لوح أمريكا */
    mature:   { 'certification.gte': 'NC-17' },
    /* وضع الموقع للبالغين: R فما فوق حسب لوح أمريكا */
    adults:   { 'certification.gte': 'R' },
    /* الإيروتيك غالبًا R أو NC-17، والاعتماد الأكبر على الكلمات المفتاحية */
    erotic:   { 'certification.gte': 'R' }
    /* الإباحي الصريح: ما نضع تصنيفًا — علم adult محور منفصل تمامًا عن NC-17 */
  };

  function discoverCert(type) {
    if (type !== 'movie') return null;
    var map = DISCOVER_CERT[currentFilter()];
    if (!map) return null;
    var out = { certification_country: 'US' };
    Object.keys(map).forEach(function (k) { out[k] = map[k]; });
    return out;
  }

  /* ------------------------------------------------------------
     وسوم المحتوى الحسّي — من بيانات TMDB الحقيقية فقط.
     مصدران: واصفات مجالس التصنيف الرسمية، وكلمات TMDB المفتاحية.
     ما نخترع نسبة ولا مدة مشاهد: ما فيه أي مصدر مجاني يعطيها.
     ------------------------------------------------------------ */

  /* واصفات رسمية موجودة فعلًا في release_dates وموزّعة على الدول،
     فنجمعها من كلها — أمريكا غالبًا فاضية وكندا والبرازيل أغنى */
  /* واصفات المجالس تُوحَّد على مصطلح إنجليزي واحد — الوسم قابل للضغط
     فلازم يكون مصطلحًا يفهمه بحث TMDB لا ترجمة عربية */
  var DESC_EN = [
    [/nudity|nude/i, 'nudity'],
    [/\bsex\b|sexual content|sexual/i, 'sex'],
    [/extreme violence/i, 'extreme violence'],
    [/violence|gore/i, 'violence'],
    [/substance abuse|drug/i, 'drugs'],
    [/coarse language|inappropriate language|profanity/i, 'profanity'],
    [/fear|horror|disturbing/i, 'horror']
  ];

  function descriptorsOf(json, type) {
    var out = [];
    ((json || {}).results || []).forEach(function (block) {
      var list = type === 'movie'
        ? (block.release_dates || []).reduce(function (a, d) { return a.concat(d.descriptors || []); }, [])
        : (block.descriptors || []);
      list.forEach(function (raw) {
        DESC_EN.forEach(function (pair) {
          if (pair[0].test(String(raw)) && out.indexOf(pair[1]) === -1) out.push(pair[1]);
        });
      });
    });
    return out;
  }

  /* كلمات TMDB المفتاحية — الأرقام مؤكَّدة من استجابات حقيقية */
  /* الوسم يحمل مصطلح TMDB الإنجليزي نفسه — لأنه هو اللي يشتغل
     لما تضغط الوسم فيبحث عنه ككلمة مفتاحية حقيقية */
  var HEAT = [
    { re: /^(pornography|porn|hardcore|porn star|porn actress|adult filmmaking)$/i, w: 100, en: 'pornography' },
    { re: /(softcore|erotic|erotica|sexploitation)/i,      w: 78, en: 'erotic' },
    { re: /(full frontal nudity|frontal nudity)/i,         w: 74, en: 'full frontal nudity' },
    { re: /(sex scene|explicit sex|graphic sex|unsimulated sex)/i, w: 68, en: 'sex scene' },
    { re: /^(female nudity|male nudity|nudity|topless)$/i,  w: 62, en: 'nudity' },
    { re: /^(sex|sexuality|sexual)$/i,                      w: 46, en: 'sex' },
    { re: /(bdsm|fetish|voyeurism|orgy|threesome)/i,        w: 55, en: 'bdsm' },
    { re: /(strip club|stripper|prostitution|prostitute|brothel)/i, w: 40, en: 'prostitution' }
  ];

  /**
   * يرجّع { score: 0..100, tags: [...] }
   * score = أقوى وسم موجود فعلًا، مو تقديرًا لمدة المشاهد.
   */
  function heatOf(keywords, adult, descriptors) {
    var tags = [], score = 0;

    /* الواصفات الرسمية أقوى دليل — تجي من مجالس التصنيف نفسها */
    (descriptors || []).forEach(function (d) {
      if (tags.indexOf(d) === -1) tags.push(d);
      if (/nudity/i.test(d)) score = Math.max(score, 70);
      else if (/\bsex\b/i.test(d)) score = Math.max(score, 66);
      else if (/sexual/i.test(d)) score = Math.max(score, 48);
    });

    (keywords || []).forEach(function (k) {
      var name = (k && k.name) || '';
      HEAT.forEach(function (h) {
        if (!h.re.test(name)) return;
        if (tags.indexOf(h.en) === -1) tags.push(h.en);
        score = Math.max(score, h.w);
      });
    });

    if (adult) { score = 100; if (tags.indexOf('pornography') === -1) tags.unshift('pornography'); }
    return { score: score, tags: tags.slice(0, 6) };
  }

  /* ---------- وسوم المحتوى للبطاقات (طلب خفيف مع تخزين) ---------- */

  var HEAT_KEY = 'cs.heat_cache';
  var heatCache = (function () {
    var c = CS.store.get(HEAT_KEY, {});
    return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
  })();
  var heatPending = {};
  var heatTimer;

  function heatPersist() {
    clearTimeout(heatTimer);
    heatTimer = setTimeout(function () {
      var keys = Object.keys(heatCache);
      if (keys.length > MAX_CACHE) {
        keys.slice(0, keys.length - MAX_CACHE).forEach(function (k) { delete heatCache[k]; });
      }
      CS.store.set(HEAT_KEY, heatCache);
    }, 900);
  }

  function heatKeyOf(item) { return item.type + ':' + item.id; }

  function cachedHeat(item) {
    if (!item) return undefined;
    if (item.heat) return item.heat;
    return heatCache[heatKeyOf(item)];
  }

  function putHeat(item, heat) {
    heatCache[heatKeyOf(item)] = heat;
    heatPersist();
  }

  function fetchHeat(item) {
    if (!item || item.source !== 'tmdb') return Promise.resolve(null);
    var k = heatKeyOf(item);
    if (heatCache[k] !== undefined) return Promise.resolve(heatCache[k]);
    if (heatPending[k]) return heatPending[k];

    heatPending[k] = CS.tmdb.req('/' + item.type + '/' + item.id + '/keywords', { language: undefined })
      .then(function (json) {
        var kws = (json.keywords || json.results || []);
        var h = heatOf(kws, item.adult);
        heatCache[k] = h;
        delete heatPending[k];
        heatPersist();
        return h;
      })
      .catch(function () { heatCache[k] = null; delete heatPending[k]; return null; });

    return heatPending[k];
  }

  CS.certs = {
    TIERS: TIERS,
    heatOf: heatOf,
    fetchHeat: fetchHeat,
    cachedHeat: cachedHeat,
    putHeat: putHeat,
    discoverCert: discoverCert,
    matureOnly: matureOnly,
    current: current,
    FILTERS: FILTERS,
    tierFromCert: tierFromCert,
    tierInfo: tierInfo,
    fromDetails: fromDetails,
    descriptorsOf: descriptorsOf,
    fetchFor: fetchFor,
    cachedFor: cachedFor,
    put: put,
    currentFilter: currentFilter,
    adultAllowed: adultAllowed,
    passes: passes
  };

})(window.CS);
