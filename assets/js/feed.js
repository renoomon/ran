/* ============================================================
   feed.js — خلاصة موحّدة: شبكة واحدة بترقيم لا نهائي
   بدل الصفوف المنفصلة، كل الأعمال في مكان واحد وتتحمّل صفحة صفحة.
   ============================================================ */

(function (CS) {
  'use strict';

  var PAGE = 50;          /* كم عمل نضيف مع كل «اعرض المزيد» */
  var TMDB_PAGE = 20;     /* TMDB يرجّع ٢٠ لكل صفحة دائمًا */

  /* ---------- أنواع TMDB اللي نحتاجها للأقسام ---------- */
  var GENRE = {
    reality: 10764,       /* Reality — تلفزيون */
    talk: 10767,
    docTv: 99,
    docMovie: 99
  };

  /* كلمات إيروتيك — تُحلّ لأرقامها من TMDB عند أول استخدام */
  /* أرقام مؤكَّدة من استجابات TMDB فعلية (لا تخمين):
     190370 erotic movie · 155477 softcore · 10053 sexploitation
     445 pornography · 281741 nudity · 267122 sex · 339680 female nudity
     7344 porn star · 158436 porn actress · 195997 adult filmmaking */
  var EROTIC_SEED = [190370, 155477, 10053, 281741, 267122, 339680];
  var EXPLICIT_SEED = [445, 7344, 158436, 195997];

  /* كلمات ما لقينا أرقامها في أي استجابة حقيقية — نحلّها وقت التشغيل */
  var EROTIC_WORDS = ['erotica', 'sex scene', 'eroticism', 'adult film'];
  var eroticIds = null;

  function eroticKeywordIds() {
    if (eroticIds) return Promise.resolve(eroticIds);
    return CS.util.pool(EROTIC_WORDS, 3, function (w) {
      return CS.tmdb.searchKeywords(w).then(function (list) {
        /* نأخذ المطابقة الحرفية فقط، لا أول نتيجة عشوائية */
        var exact = (list || []).filter(function (k) {
          return String(k.name || '').toLowerCase() === w.toLowerCase();
        })[0];
        return exact ? exact.id : null;
      }).catch(function () { return null; });
    }).then(function (ids) {
      /* البذور المؤكَّدة أولًا، وأي رقم يُحلّ وقت التشغيل يُضاف فوقها */
      eroticIds = EROTIC_SEED.concat(ids.filter(Boolean)).filter(function (v, i, a) {
        return a.indexOf(v) === i;
      });
      return eroticIds;
    });
  }

  /* ---------- حالة الخلاصة ---------- */

  function blank() {
    return {
      tab: 'all', sort: 'popularity.desc', origLang: '', minRating: 0,
      items: [], seen: {}, page: 0, exhausted: false, loading: false, token: 0
    };
  }

  var state = blank();

  function reset(patch) {
    var t = state.token + 1;
    state = blank();
    Object.keys(patch || {}).forEach(function (k) { state[k] = patch[k]; });
    state.token = t;
    return state;
  }

  function current() { return state; }

  /* ---------- بناء معاملات الاستكشاف ---------- */

  function baseParams() {
    var p = {};
    if (state.origLang) p.with_original_language = state.origLang;
    if (state.minRating) p['vote_average.gte'] = state.minRating;

    /* الترتيب: TMDB ما يعرف «على ذوقي» — نحوّله لشهرة ثم نرتّب محليًا */
    p.sort_by = state.sort === 'foryou' ? 'popularity.desc' : state.sort;

    /* حد الأصوات يمنع الأعمال المجهولة تمامًا من إغراق النتائج،
       لكن نخفّضه بشدة عشان ما ينحصر العرض في المشهور العالمي فقط */
    if (state.sort === 'vote_average.desc') p['vote_count.gte'] = 120;
    else if (!CS.certs.adultAllowed()) p['vote_count.gte'] = 8;

    return p;
  }

  /* أي نداءات TMDB يحتاجها القسم الحالي لهذه الصفحة */
  function sourcesFor(page) {
    var tab = state.tab;
    var p = baseParams();
    var jobs = [];

    function movies(extra) {
      var q = Object.assign({}, p, extra || {});
      jobs.push(CS.tmdb.discover('movie', q, page));
    }
    function shows(extra) {
      var q = Object.assign({}, p, extra || {});
      /* التاريخ في المسلسلات اسمه مختلف */
      if (q.sort_by === 'primary_release_date.desc') q.sort_by = 'first_air_date.desc';
      delete q.certification; delete q['certification.gte']; delete q.certification_country;
      jobs.push(CS.tmdb.discover('tv', q, page));
    }

    if (tab === 'movie')        movies();
    else if (tab === 'tv')      shows();
    else if (tab === 'reality') shows({ with_genres: GENRE.reality + ',' + GENRE.talk });
    else if (tab === 'doc')   { movies({ with_genres: GENRE.docMovie }); shows({ with_genres: GENRE.docTv }); }
    else if (tab === 'erotic' || tab === 'explicit') {
      /* الكلمات المفتاحية تشتغل مع include_adult على /discover —
         العطل القديم كان في نقطة /keyword/{id}/movies المهجورة، لا هنا */
      var seed = tab === 'explicit' ? EXPLICIT_SEED : null;
      var ready = seed ? Promise.resolve(seed) : eroticKeywordIds();

      return ready.then(function (ids) {
        var q = Object.assign({}, p, { with_keywords: ids.join('|') });
        delete q['vote_count.gte'];    /* أعمال الكبار ما توصل أي حد أصوات */
        return Promise.all([
          CS.tmdb.discover('movie', q, page),
          CS.tmdb.discover('tv', q, page)
        ]);
      });
    }
    else { movies(); shows(); }

    return Promise.all(jobs);
  }

  /* ---------- التحميل ---------- */

  /**
   * يحمّل الدفعة التالية ويضيفها للقائمة.
   * يرجّع { items, added, exhausted }
   */
  function loadMore() {
    if (state.loading || state.exhausted) {
      return Promise.resolve({ items: state.items, added: 0, exhausted: state.exhausted });
    }
    if (!CS.hasKey()) return Promise.reject(new Error('NO_KEY'));

    state.loading = true;
    var token = state.token;
    var target = state.items.length + PAGE;
    var emptyRounds = 0;

    function round() {
      if (token !== state.token) return Promise.resolve();
      if (state.items.length >= target || state.exhausted) return Promise.resolve();

      state.page += 1;
      /* TMDB يرفض ما بعد الصفحة ٥٠٠ */
      if (state.page > 500) { state.exhausted = true; return Promise.resolve(); }

      return sourcesFor(state.page).then(function (sets) {
        if (token !== state.token) return;

        var before = state.items.length;
        (sets || []).forEach(function (list) { absorb(list); });

        if (state.items.length === before) {
          emptyRounds++;
          /* ثلاث صفحات متتالية بلا جديد ← خلصت المادة */
          if (emptyRounds >= 3) { state.exhausted = true; return; }
        } else {
          emptyRounds = 0;
        }
        return round();
      });
    }

    return round()
      .then(function () {
        if (token !== state.token) return { items: [], added: 0, exhausted: false };
        state.loading = false;
        rank();
        return { items: state.items, added: state.items.length, exhausted: state.exhausted };
      })
      .catch(function (err) {
        state.loading = false;
        throw err;
      });
  }

  /* يضيف عناصر جديدة بعد التصفية وإزالة التكرار */
  function absorb(list) {
    var taste = CS.taste.seenSet();

    (list || []).forEach(function (it) {
      if (!it) return;
      var k = it.type + ':' + it.id;
      if (state.seen[k]) return;

      /* الإباحي ما يظهر إلا في قسم يطلبه */
      if (it.adult && !CS.certs.adultAllowed()) return;
      /* الأعمال اللي صوّت عليها ما تتكرر في الاستكشاف */
      if (taste[k]) return;
      /* بلا بوستر = بطاقة فاضية */
      if (!it.poster) return;

      state.seen[k] = true;
      state.items.push(it);
    });
  }

  /* «على ذوقي» يرتّب محليًا حسب أنواعك المفضلة */
  function rank() {
    if (state.sort !== 'foryou') return;
    var p = CS.taste.profile();
    if (!p.genres.length) return;

    var weight = {};
    p.genres.forEach(function (g, i) { weight[g] = 4 - i; });
    p.avoidGenres.forEach(function (g) { weight[g] = -4; });

    state.items.forEach(function (it) {
      var s = 0;
      (it.genreIds || []).forEach(function (g) { s += weight[g] || 0; });
      it.tasteScore = s + Math.min(3, Math.log10((it.popularity || 0) + 1));
    });
    state.items.sort(function (a, b) { return (b.tasteScore || 0) - (a.tasteScore || 0); });
  }

  CS.feed = {
    PAGE: PAGE,
    TMDB_PAGE: TMDB_PAGE,
    GENRE: GENRE,
    reset: reset,
    current: current,
    loadMore: loadMore,
    eroticKeywordIds: eroticKeywordIds
  };

})(window.CS);
