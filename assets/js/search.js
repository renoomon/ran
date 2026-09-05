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

  function engineTitle(q, qEn) {
    if (!CS.hasKey()) return engineTitleWiki(q, qEn);

    var jobs = [CS.tmdb.searchMulti(q).catch(function () { return { items: [] }; })];
    if (qEn && norm(qEn) !== norm(q)) {
      jobs.push(CS.tmdb.searchMulti(qEn).catch(function () { return { items: [] }; }));
    }

    return Promise.all(jobs).then(function (res) {
      var out = [];
      res.forEach(function (r) {
        (r.items || []).forEach(function (item, i) {
          var sim = Math.max(similarity(item.title, q), similarity(item.originalTitle, q),
                             qEn ? similarity(item.title, qEn) : 0,
                             qEn ? similarity(item.originalTitle, qEn) : 0);
          item.why = item.viaPerson ? 'person' : 'title';
          item.whyText = item.viaPerson ? ('من أعمال ' + item.viaPerson) : 'مطابقة بالاسم';
          item.engineScore = (item.viaPerson ? 34 : 62) + sim * 46 - Math.min(i, 14);
          out.push(item);
        });
      });
      return out;
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

  function enginePlot(q, qEn) {
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

      if (!CS.hasKey()) {
        return works.map(function (w) {
          var item = fromWiki(w);
          item.why = 'plot';
          item.whyText = 'مطابقة في القصة';
          item.engineScore = 66 - w.rank * 2.2;
          return item;
        });
      }

      /* مطابقة كل عمل مع TMDB عشان نجيب البوستر والتقييم والمشابهات */
      return CS.util.pool(works, 4, function (w) {
        return CS.tmdb.searchByTitle(w.type, w.cleanTitle, w.year).then(function (cands) {
          var best = pickBest(cands, w);
          if (!best) {
            var fb = fromWiki(w);
            fb.why = 'plot';
            fb.whyText = 'مطابقة في القصة (ويكيبيديا)';
            fb.engineScore = 52 - w.rank * 2.2;
            return fb;
          }
          best.why = 'plot';
          best.whyText = 'مطابقة في القصة';
          best.wikiUrl = w.wikiUrl;
          best.wikiTitle = w.wikiTitle;
          best.wikiLang = w.wikiLang;
          best.plotSnippet = w.extract;
          best.engineScore = 74 - w.rank * 2.2;
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

        if (byKey[key]) {
          var prev = byKey[key];
          /* نفس العمل طلع من أكثر من محرك ← نرفع ثقته */
          prev.score = Math.max(prev.score, item.engineScore || 0) + 12;
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
    var meta = { query: q, mode: mode, intent: intent, engines: [], translated: '', noKey: !CS.hasKey() };

    /* نترجم للإنجليزي عشان نفتح ويكيبيديا الإنجليزية وكلمات TMDB */
    var needEn = CS.util.isArabic(q);
    var prep = needEn ? CS.wiki.toEnglish(q) : Promise.resolve(q);

    return prep.then(function (qEn) {
      if (qEn && qEn !== q) meta.translated = qEn;

      var jobs = [];
      var wantTitle = (mode === 'title') || (mode === 'auto');
      var wantPlot  = (mode === 'plot')  || (mode === 'auto' && intent !== 'title');
      var wantTheme = (mode === 'theme') || (mode === 'auto');

      /* استعلام قصير جدًا؟ الاسم أهم من القصة */
      if (mode === 'auto' && intent === 'title') wantPlot = CS.util.words(q).length >= 3;

      if (wantTitle) { meta.engines.push('title'); jobs.push(engineTitle(q, qEn)); }
      if (wantPlot)  { meta.engines.push('plot');  jobs.push(enginePlot(q, qEn)); }
      if (wantTheme) { meta.engines.push('theme'); jobs.push(engineTheme(q, qEn)); }

      return Promise.all(jobs.map(function (p) {
        return p.catch(function () { return []; });
      }));
    }).then(function (sets) {
      var items = merge(sets);
      meta.core = items.length;

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

  CS.search = {
    run: run,
    suggest: suggest,
    detectIntent: detectIntent,
    similarity: similarity,
    norm: norm
  };

})(window.CS);
