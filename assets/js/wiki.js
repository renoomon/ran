/* ============================================================
   wiki.js — البحث بوصف القصة عبر ويكيبيديا + ترجمة تلقائية
   يشتغل بدون أي مفتاح API.
   ============================================================ */

(function (CS) {
  'use strict';

  var LIM = CS.config.limits;
  var cache = {};

  /* يميّز صفحات الأفلام والمسلسلات من وصف ويكي داتا */
  var RE_MOVIE  = /\b(film|movie|motion picture)\b|فيلم/i;
  var RE_TV     = /\b(television series|tv series|tv show|series|sitcom|miniseries|telenovela|drama series|anime series|web series)\b|مسلسل|سلسلة تلفزيونية|برنامج تلفزيوني/i;
  var RE_EITHER = /\b(film|movie|motion picture|television|series|sitcom|miniseries|telenovela|anime|documentary)\b|فيلم|مسلسل|سلسلة|أنمي|وثائقي/i;

  /* عناوين أقسام الحبكة في المقالات */
  var PLOT_HEADINGS = /^(القصة|الحبكة|القصّة|ملخص|ملخص القصة|ملخّص|قصة الفيلم|قصة المسلسل|الملخص|plot|synopsis|story|premise|plot summary|storyline)$/i;

  function api(lang, params) {
    params = Object.assign({ action: 'query', format: 'json', origin: '*', formatversion: 2 }, params);
    var qs = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');

    var url = 'https://' + lang + '.wikipedia.org/w/api.php?' + qs;
    if (cache[url]) return Promise.resolve(cache[url]);

    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('WIKI_HTTP_' + r.status);
        return r.json();
      })
      .then(function (json) { cache[url] = json; return json; });
  }

  /* ---------- 1) البحث في النص الكامل ---------- */

  function searchPages(lang, query, limit) {
    return api(lang, {
      list: 'search',
      srsearch: query,
      srlimit: limit || LIM.wikiSearch,
      srnamespace: 0,
      srprop: 'snippet',
      srqiprofile: 'popular_inclinks_pv'   /* يرجّح الصفحات المشهورة */
    }).then(function (json) {
      return ((json.query || {}).search || []).map(function (r) {
        return {
          pageid: r.pageid,
          title: r.title,
          snippet: CS.util.stripTags(r.snippet)
        };
      });
    }).catch(function () { return []; });
  }

  /* ---------- 2) تفاصيل الصفحات + الفلترة على الأفلام/المسلسلات ---------- */

  function pageDetails(lang, pageids) {
    if (!pageids.length) return Promise.resolve([]);
    return api(lang, {
      pageids: pageids.slice(0, 20).join('|'),
      prop: 'pageimages|pageterms|extracts|info',
      inprop: 'url',
      piprop: 'thumbnail',
      pithumbsize: 500,
      wbptterms: 'description',
      exintro: 1,
      explaintext: 1,
      exlimit: 20
    }).then(function (json) {
      return ((json.query || {}).pages || []).map(function (p) {
        var terms = p.terms || {};
        return {
          pageid: p.pageid,
          title: p.title,
          url: p.fullurl || ('https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(p.title)),
          description: (terms.description || [])[0] || '',
          extract: p.extract || '',
          thumb: (p.thumbnail || {}).source || '',
          lang: lang
        };
      });
    }).catch(function () { return []; });
  }

  /* أي نوع هذي الصفحة؟ فيلم / مسلسل / لا شي */
  function classify(page) {
    var probe = (page.description || '') + ' ' + (page.title || '') + ' ' + (page.extract || '').slice(0, 320);
    if (!RE_EITHER.test(probe)) return null;
    if (RE_TV.test(page.description) || RE_TV.test(page.title)) return 'tv';
    if (RE_MOVIE.test(page.description) || RE_MOVIE.test(page.title)) return 'movie';
    if (RE_TV.test(probe)) return 'tv';
    if (RE_MOVIE.test(probe)) return 'movie';
    return null;
  }

  /* البحث الكامل في ويكي واحدة: بحث ← تفاصيل ← فلترة */
  function findWorks(lang, query, limit) {
    return searchPages(lang, query, limit).then(function (hits) {
      if (!hits.length) return [];
      var ids = hits.map(function (h) { return h.pageid; });
      var order = {};
      hits.forEach(function (h, i) { order[h.pageid] = i; });

      return pageDetails(lang, ids).then(function (pages) {
        return pages
          .map(function (p) {
            var type = classify(p);
            if (!type) return null;
            return {
              wikiPageId: p.pageid,
              wikiTitle: p.title,
              wikiLang: lang,
              wikiUrl: p.url,
              type: type,
              cleanTitle: CS.util.cleanTitle(p.title),
              year: CS.util.yearFrom(p.description) || CS.util.yearFrom(p.title) || CS.util.yearFrom(p.extract.slice(0, 200)),
              description: p.description,
              extract: p.extract,
              thumb: p.thumb,
              rank: order[p.pageid] == null ? 99 : order[p.pageid]
            };
          })
          .filter(Boolean)
          .sort(function (a, b) { return a.rank - b.rank; });
      });
    });
  }

  /* ---------- 3) القصة الكاملة من نص المقالة ---------- */

  function fullPlot(lang, title) {
    return api(lang, {
      titles: title,
      prop: 'extracts',
      explaintext: 1,
      exlimit: 1
    }).then(function (json) {
      var page = ((json.query || {}).pages || [])[0];
      var text = (page || {}).extract || '';
      if (!text) return '';

      /* نقسم على العناوين ونلقط قسم القصة */
      var parts = text.split(/\n(?==+[^=\n]+=+\n?)/);
      var intro = parts[0] || '';
      var plot = '';

      parts.forEach(function (block) {
        var m = /^(=+)\s*([^=\n]+?)\s*\1/.exec(block);
        if (!m) return;
        if (plot) return;
        if (PLOT_HEADINGS.test(m[2].trim())) {
          plot = block.replace(/^=+[^=\n]+=+\n?/, '').trim();
        }
      });

      return (plot || intro).trim();
    }).catch(function () { return ''; });
  }

  /* ---------- 4) الترجمة المجانية (عربي ⇄ إنجليزي) ---------- */

  var trCache = {};

  function translate(text, from, to) {
    var key = from + '>' + to + ':' + text;
    if (trCache[key]) return Promise.resolve(trCache[key]);
    if (!text || text.length > 480) return Promise.resolve('');

    var url = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text) + '&langpair=' + from + '|' + to;

    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        var out = ((json || {}).responseData || {}).translatedText || '';
        /* الخدمة ترجّع رسائل الحصة كنص عادي — نتجاهلها */
        if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) return '';
        trCache[key] = out;
        return out;
      })
      .catch(function () { return ''; });
  }

  /* يرجّع النسخة الإنجليزية من الاستعلام (أو نفسه لو كان إنجليزي) */
  function toEnglish(query) {
    if (!CS.util.isArabic(query)) return Promise.resolve(query);
    return translate(query, 'ar', 'en').then(function (en) { return en || ''; });
  }

  CS.wiki = {
    findWorks: findWorks,
    fullPlot: fullPlot,
    translate: translate,
    toEnglish: toEnglish
  };

})(window.CS);
