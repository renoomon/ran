/* ============================================================
   search.js — منسّق البحث متعدد المحركات
   1) بالاسم    : TMDB /search/multi
   2) بوصف القصة: ويكيبيديا (نص كامل) ← مطابقة مع TMDB
   3) بالثيمة   : TMDB keywords ← discover
   ثم دمج + ترتيب + إضافة الأعمال ذات الصلة.
   ============================================================ */

(function (CS) {
  'use strict';

  var LIM = CS.config.limits;

  /* ---------- تطبيع النصوص للمقارنة ---------- */

  function norm(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')      // تشكيل
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/[ىی]/g, 'ي')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return .88;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return .74;

    var wa = a.split(' '), wb = b.split(' ');
    var hit = wa.filter(function (w) { return w.length > 2 && wb.indexOf(w) !== -1; }).length;
    return hit ? Math.min(.7, hit / Math.max(wa.length, wb.length)) : 0;
  }

  /* ---------- نية الاستعلام ---------- */

  var PLOT_HINTS = /(عن |قصة|حكاية|يحكي|يتكلم|فيه واحد|رجل |امرأة |ولد |شاب |فتاة |بطل |يعيش|يحاول|يكتشف|ينتقم|about |story |guy who|man who|woman who|where a |a movie|a series|في مسلسل|في فيلم)/i;

  function detectIntent(query) {
    var words = CS.util.words(query);
    if (words.length >= 6) return 'plot';
    if (PLOT_HINTS.test(query) && words.length >= 4) return 'plot';
    if (words.length <= 3) return 'title';
    return 'mixed';
  }

  /* ---------- محرك 1: بالاسم ---------- */

  /**
   * البحث بالاسم على مرحلتين:
   *  أ) نبحث بالنص كما كتبه المستخدم — TMDB يفهرس العناوين العربية
   *  ب) ما لقينا تطابقًا قويًا؟ عندها فقط نستعين بالترجمة الإنجليزية
   * الترتيب هذا يمنع الترجمة من إغراق نتيجة عربية صحيحة.
   */
  function engineTitle(q, qEn) {
    if (!CS.hasKey()) return engineTitleWiki(q, qEn);

    function score(items, viaTranslation) {
      return items.map(function (item, i) {
        var sim = Math.max(similarity(item.title, q), similarity(item.originalTitle, q),
                           qEn ? similarity(item.title, qEn) : 0,
                           qEn ? similarity(item.originalTitle, qEn) : 0);
        item.titleSim = sim;
        item.why = item.viaPerson ? 'person' : 'title';
        item.whyText = item.viaPerson ? ('من أعمال ' + item.viaPerson)
                     : viaTranslation ? 'مطابقة بالاسم (عبر الترجمة)' : 'مطابقة بالاسم';

        var base = item.viaPerson ? 34 : 66;
        if (viaTranslation) base -= 16;              /* الترجمة أضعف دليلًا */
        if (sim >= .85) base += 55;                  /* تطابق شبه تام ← يتصدّر */
        else if (sim >= .7) base += 26;
        item.engineScore = base + sim * 40 - Math.min(i, 14);
        return item;
      });
    }

    var native = Promise.all([
      CS.tmdb.searchMulti(q).catch(function () { return { items: [] }; }),
      CS.tmdb.searchTitleBoth(q).catch(function () { return []; })
    ]).then(function (r) {
      var seen = {}, out = [];
      (r[0].items || []).concat(r[1]).forEach(function (it) {
        var k = it.type + ':' + it.id;
        if (seen[k]) return;
        seen[k] = true;
        out.push(it);
      });
      return score(out, false);
    });

    return native.then(function (items) {
      var best = items.reduce(function (m, x) { return Math.max(m, x.titleSim || 0); }, 0);

      /* لقينا العمل بالعربي؟ خلاص، ما نحتاج نترجم */
      if (best >= .7 || !qEn || norm(qEn) === norm(q)) return items;

      return CS.tmdb.searchMulti(qEn)
        .catch(function () { return { items: [] }; })
        .then(function (r) {
          var have = {};
          items.forEach(function (x) { have[x.type + ':' + x.id] = true; });
          var extra = (r.items || []).filter(function (x) { return !have[x.type + ':' + x.id]; });
          return items.concat(score(extra, true));
        });
    });
  }

  /* بديل بدون مفتاح: نبحث بالاسم داخل ويكيبيديا */
  function engineTitleWiki(q, qEn) {
    var jobs = [CS.wiki.findWorks('ar', q, 10)];
    if (qEn && qEn !== q) jobs.push(CS.wiki.findWorks('en', qEn, 10));
    else if (!CS.util.isArabic(q)) jobs.push(CS.wiki.findWorks('en', q, 10));

    return Promise.all(jobs).then(function (sets) {
      var out = [];
      sets.forEach(function (set) {
        set.forEach(function (w) {
          var item = fromWiki(w);
          item.why = 'title';
          item.whyText = 'مطابقة بالاسم (ويكيبيديا)';
          item.engineScore = 58 + similarity(w.cleanTitle, q) * 40 - w.rank;
          out.push(item);
        });
      });
      return out;
    });
  }

  /* ---------- محرك 2: بوصف القصة ---------- */

  function enginePlot(q, qEn, asTitle) {
    var jobs = [CS.wiki.findWorks('ar', q, LIM.wikiSearch)];
    var english = qEn || (!CS.util.isArabic(q) ? q : '');
    if (english) jobs.push(CS.wiki.findWorks('en', english, LIM.wikiSearch));

    return Promise.all(jobs).then(function (sets) {
      /* دمج نتائج الويكيين قبل المطابقة */
      var seen = {}, works = [];
      sets.forEach(function (set, si) {
        set.forEach(function (w) {
          var k = norm(w.cleanTitle) + '|' + (w.year || '');
          if (seen[k]) { seen[k].rank = Math.min(seen[k].rank, w.rank + si * 0.5); return; }
          w.rank = w.rank + si * 0.5;
          seen[k] = w;
          works.push(w);
        });
      });
      works.sort(function (a, b) { return a.rank - b.rank; });
      works = works.slice(0, LIM.wikiResolve);

      /* على بحث بالاسم نصنّف النتيجة كمطابقة عنوان لا كمطابقة قصة */
      function label(w, resolved) {
        if (!asTitle) return resolved ? 'مطابقة في القصة' : 'مطابقة في القصة (ويكيبيديا)';
        return 'مطابقة بالاسم (ويكيبيديا)';
      }
      function bonus(w, item) {
        if (!asTitle) return 0;
        var sim = Math.max(similarity(w.cleanTitle, q), similarity((item || {}).title || '', q));
        if (item) item.titleSim = Math.max(item.titleSim || 0, sim);
        return sim >= .85 ? 52 : sim >= .7 ? 24 : 0;
      }

      if (!CS.hasKey()) {
        return works.map(function (w) {
          var item = fromWiki(w);
          item.why = asTitle ? 'title' : 'plot';
          item.whyText = label(w, false);
          item.engineScore = 66 - w.rank * 2.2 + bonus(w, item);
          return item;
        });
      }

      /* مطابقة كل عمل مع TMDB عشان نجيب البوستر والتقييم والمشابهات */
      return CS.util.pool(works, 4, function (w) {
        return CS.tmdb.searchByTitle(w.type, w.cleanTitle, w.year).then(function (cands) {
          var best = pickBest(cands, w);
          if (!best) {
            var fb = fromWiki(w);
            fb.why = asTitle ? 'title' : 'plot';
            fb.whyText = label(w, false);
            fb.engineScore = 52 - w.rank * 2.2 + bonus(w, fb);
            return fb;
          }
          best.why = asTitle ? 'title' : 'plot';
          best.whyText = label(w, true);
          best.wikiUrl = w.wikiUrl;
          best.wikiTitle = w.wikiTitle;
          best.wikiLang = w.wikiLang;
          best.plotSnippet = w.extract;
          best.engineScore = 74 - w.rank * 2.2 + bonus(w, best);
          return best;
        });
      });
    });
  }

  function pickBest(cands, work) {
    if (!cands || !cands.length) return null;
    var scored = cands.slice(0, 6).map(function (c) {
      var s = similarity(c.title, work.cleanTitle) * 40
            + similarity(c.originalTitle || '', work.cleanTitle) * 40;
      if (work.year && c.year) {
        var d = Math.abs(c.year - work.year);
        s += d === 0 ? 40 : d === 1 ? 22 : d <= 3 ? 6 : -25;
      }
      s += Math.min(10, Math.log10((c.popularity || 0) + 1) * 5);
      return { c: c, s: s };
    }).sort(function (a, b) { return b.s - a.s; });

    return scored[0].s > 18 ? scored[0].c : null;
  }

  /* ---------- محرك 3: بالثيمة (الكلمات المفتاحية) ---------- */

  function engineTheme(q, qEn) {
    if (!CS.hasKey()) return Promise.resolve([]);
    var probe = qEn || q;

    return CS.tmdb.searchKeywords(probe).then(function (kws) {
      if (!kws.length) {
        /* نجرّب أهم كلمة في الجملة */
        var big = CS.util.words(probe)
          .filter(function (w) { return w.length > 3; })
          .sort(function (a, b) { return b.length - a.length; })[0];
        if (!big) return [];
        return CS.tmdb.searchKeywords(big);
      }
      return kws;
    }).then(function (kws) {
      if (!kws.length) return [];
      var ids = kws.slice(0, LIM.keywordSeeds).map(function (k) { return k.id; });
      var names = kws.slice(0, LIM.keywordSeeds).map(function (k) { return k.name; }).join('، ');

      return Promise.all([
        CS.tmdb.discoverByKeywords('movie', ids),
        CS.tmdb.discoverByKeywords('tv', ids)
      ]).then(function (res) {
        var out = [];
        res.forEach(function (list) {
          list.forEach(function (item, i) {
            item.why = 'theme';
            item.whyText = 'نفس الثيمة: ' + names;
            item.engineScore = 44 - Math.min(i, 18);
            out.push(item);
          });
        });
        return out;
      });
    }).catch(function () { return []; });
  }

  /* ---------- عنصر من ويكيبيديا فقط ---------- */

  function fromWiki(w) {
    return {
      id: 'w' + w.wikiPageId,
      type: w.type,
      title: w.cleanTitle,
      originalTitle: '',
      year: w.year,
      date: w.year ? String(w.year) : '',
      poster: w.thumb,
      posterLarge: w.thumb,
      backdrop: '',
      rating: 0,
      votes: 0,
      popularity: 0,
      overview: w.extract || w.description || '',
      plotSnippet: w.extract || '',
      genreIds: [],
      source: 'wiki',
      wikiUrl: w.wikiUrl,
      wikiTitle: w.wikiTitle,
      wikiLang: w.wikiLang,
      wikiDescription: w.description
    };
  }

  /* ---------- الدمج والترتيب ---------- */

  function merge(sets) {
    var byKey = {}, order = [];

    sets.forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item) return;
        var key = item.source === 'wiki'
          ? 'w:' + norm(item.title) + ':' + (item.year || '')
          : item.type + ':' + item.id;

        /* المحتوى الإباحي ما يظهر إلا لو الفلتر يسمح به صراحة */
        if (item.adult && CS.certs && !CS.certs.adultAllowed()) return;

        if (byKey[key]) {
          var prev = byKey[key];
          /* نفس العمل طلع من أكثر من محرك ← نرفع ثقته */
          prev.score = Math.max(prev.score, item.engineScore || 0) + 12;
          prev.titleSim = Math.max(prev.titleSim || 0, item.titleSim || 0);
          prev.engines = prev.engines || [];
          if (prev.engines.indexOf(item.why) === -1) prev.engines.push(item.why);
          if (!prev.wikiUrl && item.wikiUrl) { prev.wikiUrl = item.wikiUrl; prev.wikiTitle = item.wikiTitle; prev.wikiLang = item.wikiLang; }
          if (!prev.plotSnippet && item.plotSnippet) prev.plotSnippet = item.plotSnippet;
          if (!prev.overview && item.overview) prev.overview = item.overview;
          return;
        }

        item.score = item.engineScore || 0;
        item.engines = [item.why];
        byKey[key] = item;
        order.push(item);
      });
    });

    /* مكافآت الجودة */
    order.forEach(function (item) {
      item.score += Math.min(11, Math.log10((item.popularity || 0) + 1) * 5.5);
      if (item.votes > 120) item.score += Math.min(6, (item.rating || 0) * .65);
      if (!item.poster) item.score -= 9;
      if (item.source === 'wiki') item.score -= 4;
      /* تطابق العنوان يغلب أي إشارة ثانية */
      if ((item.titleSim || 0) >= .85) item.score += 40;
    });

    order.sort(function (a, b) { return b.score - a.score; });
    return order;
  }

  /* ---------- الأعمال ذات الصلة (من أفضل نتيجة) ---------- */

  function relatedTo(top) {
    if (!CS.hasKey() || !top || top.source !== 'tmdb') return Promise.resolve([]);

    return Promise.all([
      CS.tmdb.req('/' + top.type + '/' + top.id + '/recommendations', { page: 1 }).catch(function () { return {}; }),
      CS.tmdb.req('/' + top.type + '/' + top.id + '/similar', { page: 1 }).catch(function () { return {}; })
    ]).then(function (res) {
      var out = [];
      var label = 'قريب من «' + top.title + '»';
      [res[0], res[1]].forEach(function (json, k) {
        CS.tmdb.normalizeList((json || {}).results || [], top.type).forEach(function (item, i) {
          item.why = 'related';
          item.whyText = label;
          item.engineScore = (k === 0 ? 30 : 24) - Math.min(i, 16);
          out.push(item);
        });
      });
      return out;
    }).catch(function () { return []; });
  }

  /* ---------- الواجهة الرئيسية ---------- */

  /**
   * run(query, mode) → { items, meta }
   * mode: auto | title | plot | theme
   */
  function run(query, mode) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve({ items: [], meta: {} });

    mode = mode || 'auto';
    var intent = mode === 'auto' ? detectIntent(q) : mode;
    var isAr = CS.util.isArabic(q);
    var meta = { query: q, mode: mode, intent: intent, engines: [], translated: '', noKey: !CS.hasKey() };

    /* نترجم للإنجليزي عشان نفتح ويكيبيديا الإنجليزية وكلمات TMDB */
    var prep = isAr ? CS.wiki.toEnglish(q) : Promise.resolve(q);

    return prep.then(function (qEn) {
      if (qEn && qEn !== q) meta.translated = qEn;

      var jobs = [];
      var wantTitle = (mode === 'title') || (mode === 'auto');
      var wantPlot  = (mode === 'plot')  || (mode === 'auto' && intent !== 'title');
      /* الثيمة تخدم وصف القصة — على بحث بالاسم تجيب ضجيج فقط */
      var wantTheme = (mode === 'theme') || (mode === 'auto' && intent !== 'title');

      /* بحث بالاسم بالعربي: ويكيبيديا العربية أقوى مصدر لمطابقة العنوان */
      if (mode === 'auto' && intent === 'title') wantPlot = isAr || CS.util.words(q).length >= 3;

      /* فحص صحة TMDB بالتوازي — عشان نفرّق بين «ما فيه نتيجة» و«المفتاح ميت» */
      if (CS.hasKey()) {
        jobs.push(
          CS.tmdb.req('/configuration', {})
            .then(function () { return []; })
            .catch(function (e) { meta.tmdbError = CS.tmdb.explain(e); return []; })
        );
      }

      if (wantTitle) { meta.engines.push('title'); jobs.push(engineTitle(q, qEn)); }
      if (wantPlot)  {
        var asTitle = (mode === 'auto' && intent === 'title');
        meta.engines.push(asTitle ? 'wikiTitle' : 'plot');
        jobs.push(enginePlot(q, qEn, asTitle));
      }
      if (wantTheme) { meta.engines.push('theme'); jobs.push(engineTheme(q, qEn)); }

      return Promise.all(jobs.map(function (p) {
        return p.catch(function () { return []; });
      }));
    }).then(function (sets) {
      var items = merge(sets);
      meta.core = items.length;

      /* لقينا العنوان بثقة؟ ما نعرض الترجمة عشان ما توهم إننا بدّلنا بحثه */
      var strong = items.some(function (x) { return (x.titleSim || 0) >= .85; });
      if (strong && intent === 'title') meta.translated = '';

      /* نضيف الأعمال ذات الصلة بأفضل نتيجة */
      var top = items[0];
      if (!top) return { items: items, meta: meta };

      return relatedTo(top).then(function (rel) {
        if (!rel.length) return { items: items, meta: meta };
        var all = merge([items, rel]);
        meta.related = rel.length;
        meta.relatedOf = top.title;
        return { items: all, meta: meta };
      });
    });
  }

  /* ---------- اقتراحات فورية أثناء الكتابة ---------- */

  function suggest(q) {
    if (!CS.hasKey()) return Promise.resolve([]);
    return CS.tmdb.searchMulti(q)
      .then(function (r) {
        return (r.items || [])
          .filter(function (i) { return !i.viaPerson; })
          .slice(0, LIM.suggest);
      })
      .catch(function () { return []; });
  }

  /* ============================================================
     الاستكشاف المبني على الذوق
     ============================================================ */

  function dedupe(list, seen, taken) {
    return list.filter(function (it) {
      var k = it.type + ':' + it.id;
      if (seen[k] || taken[k]) return false;
      if (it.adult && CS.certs && !CS.certs.adultAllowed()) return false;
      taken[k] = true;
      return true;
    });
  }

  /**
   * يرجّع صفوف صفحة الاستكشاف حسب ما أعجب المستخدم.
   * كل صف: { key, title, hint, items }
   */
  function discoverRows() {
    if (!CS.hasKey()) return Promise.resolve([]);

    /* نتحقق أولًا إن TMDB يرد فعلًا، عشان نفرّق بين «ما فيه نتائج»
       و«المفتاح ميت / الشبكة حاجبة» ونقولها للمستخدم بدل شاشة فاضية */
    return CS.tmdb.req('/configuration', {}).then(function () {
      return buildRows();
    }).catch(function (err) {
      var e = new Error('TMDB_DOWN');
      e.reason = CS.tmdb.explain(err);
      throw e;
    });
  }

  function buildRows() {
    var p = CS.taste.profile();
    var seen = CS.taste.seenSet();
    var taken = {};
    var rows = [];

    /* ما فيه ذوق بعد ← صفوف عامة */
    if (!p.total) {
      return Promise.all([
        CS.tmdb.trending('week'),
        CS.tmdb.nowPlaying(),
        CS.tmdb.airingToday(),
        CS.tmdb.topRated('movie')
      ]).then(function (r) {
        return [
          { key: 'trend',  title: '🔥 الأكثر رواجًا هذا الأسبوع', hint: 'أفلام ومسلسلات', items: dedupe(r[0], seen, taken) },
          { key: 'cinema', title: '🎟️ في السينما الآن',           hint: CS.state.region,   items: dedupe(r[1], seen, {}) },
          { key: 'air',    title: '📺 مسلسلات تُعرض حاليًا',        hint: '',                items: dedupe(r[2], seen, {}) },
          { key: 'top',    title: '🏆 أعلى الأفلام تقييمًا',        hint: 'على مرّ التاريخ',  items: dedupe(r[3], seen, {}) }
        ].filter(function (row) { return row.items.length; });
      });
    }

    var genreNames = (p.genres || []).map(function (id) {
      return CS.state.genres.movie[id] || CS.state.genres.tv[id];
    }).filter(Boolean).slice(0, 3).join('، ');

    var jobs = [];

    /* ١) مختارة لك — من أكثر أنواعك تكرارًا */
    if (p.genres.length) {
      var base = {
        with_genres: p.genres.join(','),
        without_genres: p.avoidGenres.length ? p.avoidGenres.join(',') : undefined,
        'vote_count.gte': 60
      };
      jobs.push(Promise.all([
        CS.tmdb.discover(p.leansTv ? 'tv' : 'movie', base),
        CS.tmdb.discover(p.leansTv ? 'movie' : 'tv', base)
      ]).then(function (r) {
        return {
          key: 'foryou',
          title: '🎯 مختارة لك',
          hint: genreNames ? 'مبنية على: ' + genreNames : '',
          items: dedupe(r[0].concat(r[1]), seen, taken)
        };
      }));
    }

    /* ٢) لأنك حبيت … */
    (p.recent || []).slice(0, 2).forEach(function (liked) {
      jobs.push(
        CS.tmdb.req('/' + liked.type + '/' + liked.id + '/recommendations', { page: 1 })
          .then(function (json) {
            return {
              key: 'like:' + liked.type + ':' + liked.id,
              title: '❤️ لأنك حبيت «' + liked.title + '»',
              hint: '',
              items: dedupe(CS.tmdb.normalizeList(json.results || [], liked.type), seen, taken)
            };
          })
          .catch(function () { return null; })
      );
    });

    /* ٣) الأجواء اللي تحبها — من الكلمات المفتاحية */
    if (p.keywords.length) {
      jobs.push(Promise.all([
        CS.tmdb.discoverByKeywords('movie', p.keywords),
        CS.tmdb.discoverByKeywords('tv', p.keywords)
      ]).then(function (r) {
        return {
          key: 'mood',
          title: '🌙 أجواء تشبه اللي عجبك',
          hint: '',
          items: dedupe(r[0].concat(r[1]), seen, taken)
        };
      }));
    }

    /* ٤) الرائج — يضل موجود دايمًا */
    jobs.push(CS.tmdb.trending('week').then(function (list) {
      return { key: 'trend', title: '🔥 الأكثر رواجًا', hint: 'بغضّ النظر عن ذوقك', items: dedupe(list, seen, taken) };
    }));

    return Promise.all(jobs).then(function (res) {
      return res.filter(function (row) { return row && row.items && row.items.length >= 2; });
    });
  }

  CS.search = {
    run: run,
    discoverRows: discoverRows,
    suggest: suggest,
    detectIntent: detectIntent,
    similarity: similarity,
    norm: norm
  };

})(window.CS);
