/* ============================================================
   tmdb.js — عميل TMDB (يدعم مفتاح v3 وتوكن v4)
   ============================================================ */

(function (CS) {
  'use strict';

  var CFG = CS.config.tmdb;
  var cache = {};

  /* توكن v4 عبارة عن JWT فيه نقطتين وطويل، ومفتاح v3 هاش 32 خانة */
  function isV4(key) { return key.split('.').length === 3 && key.length > 100; }

  function langTag() { return CS.state.lang === 'ar' ? 'ar-SA' : 'en-US'; }

  function buildUrl(path, params) {
    var key = CS.state.apiKey || '';
    var qs = [];
    params = params || {};
    if (!('language' in params)) params.language = langTag();

    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    if (key && !isV4(key)) qs.push('api_key=' + encodeURIComponent(key));

    return CFG.base + path + (qs.length ? '?' + qs.join('&') : '');
  }

  /* ---------- الطلب الأساسي ---------- */

  function req(path, params, opts) {
    opts = opts || {};
    if (!CS.hasKey()) return Promise.reject(new Error('NO_KEY'));

    var url = buildUrl(path, params);
    if (!opts.fresh && cache[url]) return Promise.resolve(cache[url]);

    var headers = { accept: 'application/json' };
    var key = CS.state.apiKey;
    if (isV4(key)) headers.Authorization = 'Bearer ' + key;

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (res.status === 401) throw new Error('BAD_KEY');
        if (res.status === 429) throw new Error('RATE_LIMIT');
        if (!res.ok) throw new Error('HTTP_' + res.status);
        return res.json();
      })
      .then(function (json) {
        cache[url] = json;
        return json;
      });
  }

  /* ---------- الصور ---------- */

  function img(path, size) {
    if (!path) return '';
    return CFG.img + '/' + size + path;
  }

  /* ---------- توحيد شكل العنصر ---------- */

  function normalize(raw, forcedType) {
    if (!raw) return null;
    var type = forcedType || raw.media_type || (raw.first_air_date || raw.name ? 'tv' : 'movie');
    if (type !== 'movie' && type !== 'tv') return null;

    var date = raw.release_date || raw.first_air_date || '';
    var title = raw.title || raw.name || '';
    var original = raw.original_title || raw.original_name || '';

    return {
      id: raw.id,
      type: type,
      title: title || original || 'بدون عنوان',
      originalTitle: original && original !== title ? original : '',
      date: date,
      year: CS.util.year(date),
      poster: img(raw.poster_path, CFG.poster.md),
      posterLarge: img(raw.poster_path, CFG.poster.lg),
      backdrop: img(raw.backdrop_path, CFG.backdrop.lg),
      rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : 0,
      votes: raw.vote_count || 0,
      popularity: raw.popularity || 0,
      overview: raw.overview || '',
      genreIds: raw.genre_ids || (raw.genres || []).map(function (g) { return g.id; }),
      source: 'tmdb'
    };
  }

  function normalizeList(list, forcedType) {
    return (list || [])
      .map(function (r) { return normalize(r, forcedType); })
      .filter(Boolean);
  }

  /* ---------- الأنواع (Genres) ---------- */

  function loadGenres() {
    if (!CS.hasKey()) return Promise.resolve();
    return Promise.all([
      req('/genre/movie/list').catch(function () { return { genres: [] }; }),
      req('/genre/tv/list').catch(function () { return { genres: [] }; })
    ]).then(function (res) {
      CS.state.genres.movie = {};
      CS.state.genres.tv = {};
      (res[0].genres || []).forEach(function (g) { CS.state.genres.movie[g.id] = g.name; });
      (res[1].genres || []).forEach(function (g) { CS.state.genres.tv[g.id] = g.name; });
    });
  }

  function genreNames(item) {
    var map = CS.state.genres[item.type] || {};
    return (item.genreIds || []).map(function (id) { return map[id]; }).filter(Boolean);
  }

  /* ---------- البحث ---------- */

  function searchMulti(query, page) {
    return req('/search/multi', {
      query: query, page: page || 1, include_adult: false
    }).then(function (json) {
      var people = (json.results || []).filter(function (r) { return r.media_type === 'person'; });
      var items = normalizeList(json.results);

      /* أعمال الأشخاص المطابقين تدخل كنتائج ذات صلة */
      people.slice(0, 2).forEach(function (p) {
        normalizeList(p.known_for || []).forEach(function (k) {
          k.viaPerson = p.name;
          items.push(k);
        });
      });
      return { items: items, total: json.total_results || 0, pages: json.total_pages || 1 };
    });
  }

  function searchByTitle(type, query, year) {
    var params = { query: query, include_adult: false, page: 1 };
    if (year) params[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
    return req('/search/' + type, params)
      .then(function (json) { return normalizeList(json.results, type); })
      .catch(function () { return []; });
  }

  /* البحث بالكلمات المفتاحية: نحوّل الوصف لثيمات ثم نستكشف بها */
  function searchKeywords(query) {
    return req('/search/keyword', { query: query, page: 1, language: undefined })
      .then(function (json) { return json.results || []; })
      .catch(function () { return []; });
  }

  function discoverByKeywords(type, keywordIds, page) {
    return req('/discover/' + type, {
      with_keywords: keywordIds.join('|'),
      sort_by: 'popularity.desc',
      include_adult: false,
      'vote_count.gte': 30,
      page: page || 1
    }).then(function (json) { return normalizeList(json.results, type); })
      .catch(function () { return []; });
  }

  /* ---------- التفاصيل ---------- */

  function details(type, id) {
    var appends = type === 'movie'
      ? 'videos,credits,external_ids,similar,recommendations,keywords,release_dates,watch/providers'
      : 'videos,aggregate_credits,external_ids,similar,recommendations,keywords,content_ratings,watch/providers';

    return req('/' + type + '/' + id, { append_to_response: appends })
      .then(function (raw) {
        var base = normalize(raw, type);
        if (!base) throw new Error('NOT_FOUND');

        base.tagline    = raw.tagline || '';
        base.runtime    = raw.runtime || (raw.episode_run_time || [])[0] || 0;
        base.status     = raw.status || '';
        base.homepage   = raw.homepage || '';
        base.budget     = raw.budget || 0;
        base.revenue    = raw.revenue || 0;
        base.genres     = (raw.genres || []).map(function (g) { return g.name; });
        base.countries  = (raw.production_countries || []).map(function (c) { return c.name; });
        base.companies  = (raw.production_companies || []).map(function (c) { return c.name; });
        base.languageOf = raw.original_language || '';
        base.imdbId     = raw.imdb_id || (raw.external_ids || {}).imdb_id || '';
        base.tvdbId     = (raw.external_ids || {}).tvdb_id || '';
        base.seasons    = raw.number_of_seasons || 0;
        base.episodes   = raw.number_of_episodes || 0;
        base.lastAir    = raw.last_air_date || '';
        base.creators   = (raw.created_by || []).map(function (c) { return c.name; });
        base.networks   = (raw.networks || []).map(function (n) { return n.name; });

        /* الطاقم */
        var credits = raw.credits || raw.aggregate_credits || {};
        base.cast = (credits.cast || []).slice(0, 14).map(function (c) {
          var role = c.character || ((c.roles || [])[0] || {}).character || '';
          return { name: c.name, role: role, photo: img(c.profile_path, CFG.profile) };
        });
        base.directors = (credits.crew || [])
          .filter(function (c) { return c.job === 'Director' || c.job === 'Series Director'; })
          .map(function (c) { return c.name; }).slice(0, 3);
        base.writers = (credits.crew || [])
          .filter(function (c) { return c.department === 'Writing'; })
          .map(function (c) { return c.name; }).slice(0, 3);

        /* التريلر: نفضّل العربي ثم الرسمي ثم أي شي */
        var vids = ((raw.videos || {}).results || []).filter(function (v) { return v.site === 'YouTube'; });
        var trailer = vids.filter(function (v) { return v.type === 'Trailer' && v.official; })[0]
                   || vids.filter(function (v) { return v.type === 'Trailer'; })[0]
                   || vids.filter(function (v) { return v.type === 'Teaser'; })[0]
                   || vids[0];
        base.trailer = trailer ? { key: trailer.key, name: trailer.name } : null;

        /* منصات المشاهدة في المنطقة المختارة */
        var wp = (raw['watch/providers'] || {}).results || {};
        var region = wp[CS.state.region] || {};
        base.providers = {
          link: region.link || '',
          flatrate: (region.flatrate || []).map(provider),
          rent: (region.rent || []).map(provider),
          buy: (region.buy || []).map(provider)
        };

        base.keywords = ((raw.keywords || {}).keywords || (raw.keywords || {}).results || [])
          .map(function (k) { return { id: k.id, name: k.name }; });

        base.similar = normalizeList(((raw.similar || {}).results || []), type);
        base.recommendations = normalizeList(((raw.recommendations || {}).results || []), type);

        return base;
      });
  }

  function provider(p) {
    return { name: p.provider_name, logo: img(p.logo_path, CFG.logo) };
  }

  /* الوصف بلغة ثانية لو كان فاضي بالعربي */
  function overviewFallback(type, id) {
    return req('/' + type + '/' + id, { language: 'en-US' })
      .then(function (raw) { return raw.overview || ''; })
      .catch(function () { return ''; });
  }

  /* ---------- صفحات الاستكشاف ---------- */

  function trending(window_) {
    return req('/trending/all/' + (window_ || 'week'))
      .then(function (json) { return normalizeList(json.results); })
      .catch(function () { return []; });
  }

  function topRated(type) {
    return req('/' + type + '/top_rated', { page: 1 })
      .then(function (json) { return normalizeList(json.results, type); })
      .catch(function () { return []; });
  }

  function nowPlaying() {
    return req('/movie/now_playing', { page: 1, region: CS.state.region })
      .then(function (json) { return normalizeList(json.results, 'movie'); })
      .catch(function () { return []; });
  }

  function airingToday() {
    return req('/tv/on_the_air', { page: 1 })
      .then(function (json) { return normalizeList(json.results, 'tv'); })
      .catch(function () { return []; });
  }

  /* ---------- اختبار المفتاح ---------- */

  function testKey(key) {
    var prev = CS.state.apiKey;
    CS.state.apiKey = key;
    return req('/configuration', {}, { fresh: true })
      .then(function () { return true; })
      .catch(function (err) { CS.state.apiKey = prev; throw err; });
  }

  CS.tmdb = {
    req: req,
    img: img,
    normalize: normalize,
    normalizeList: normalizeList,
    loadGenres: loadGenres,
    genreNames: genreNames,
    searchMulti: searchMulti,
    searchByTitle: searchByTitle,
    searchKeywords: searchKeywords,
    discoverByKeywords: discoverByKeywords,
    details: details,
    overviewFallback: overviewFallback,
    trending: trending,
    topRated: topRated,
    nowPlaying: nowPlaying,
    airingToday: airingToday,
    testKey: testKey
  };

})(window.CS);
