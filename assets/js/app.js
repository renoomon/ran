/* ============================================================
   app.js — التوجيه، الأحداث، وربط كل شي مع بعض
   الصفحات: الاستكشاف · النتائج · العمل (صفحة كاملة) · عجبني
   ============================================================ */

(function (CS) {
  'use strict';

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var LIM = CS.config.limits;

  /* مخزن مؤقت للعناصر المعروضة عشان نرجع لها بسرعة */
  var itemCache = {};

  function remember(list) {
    (list || []).forEach(function (it) {
      if (it) itemCache[CS.ui.itemKey(it)] = it;
    });
  }

  function attrEsc(v) { return String(v).replace(/(["\\])/g, '\\$1'); }

  /* ============================================================
     تبديل الصفحات
     ============================================================ */

  var VIEWS = ['home', 'results', 'liked', 'detail'];

  function showView(name) {
    CS.state.view = name;
    VIEWS.forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
    document.body.classList.toggle('is-detail', name === 'detail');
  }

  /* ============================================================
     التصنيف العمري — تحميل كسول للشبكات
     ============================================================ */

  /* يجيب تصنيفات دفعة من العناصر (مع تخزين داخلي) */
  function ensureCerts(list, cap) {
    var need = (list || []).slice(0, cap || 60).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedFor(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchFor(it); });
  }

  /* يرسم الشارات على البطاقات المعروضة بعد ما توصل التصنيفات */
  function paintCertBadges(root, list) {
    (list || []).forEach(function (it) {
      var info = CS.certs.cachedFor(it);
      if (!info) return;
      var poster = root.querySelector('.card[data-key="' + attrEsc(CS.ui.itemKey(it)) + '"] .card__poster');
      if (!poster || poster.querySelector('.card__cert')) return;
      poster.insertAdjacentHTML('beforeend', CS.ui.certBadge(it));
    });
  }

  function hydrateCerts(root, list) {
    ensureCerts(list).then(function () { paintCertBadges(root, list); });
  }

  /* ============================================================
     الصفحة الرئيسية = الاستكشاف
     ============================================================ */

  function renderHome() {
    showView('home');
    var wrap = $('#home-rows');
    var counts = CS.taste.counts();

    $('#taste-state').innerHTML = counts.likes
      ? '🟢 ذوقك مبني على <b>' + counts.likes + '</b> عمل عجبك' +
        (counts.dislikes ? ' و<b>' + counts.dislikes + '</b> ما عجبك' : '') +
        ' — <button class="linkish" id="btn-reset-taste">صفّر ذوقي</button>'
      : '🟡 اضغط 👍 على أي عمل، وهذي الصفحة تتحول لذوقك أنت.';

    wrap.innerHTML = '<div class="grid">' + CS.ui.skeletons(12) + '</div>';

    CS.search.discoverRows().then(function (rows) {
      if (CS.state.view !== 'home') return;
      if (!rows.length) {
        wrap.innerHTML = '<div class="empty"><b>🔴 ما وصلني شي من TMDB</b>' +
          '<p>تأكد من اتصالك. البحث بوصف القصة (ويكيبيديا) شغّال على أي حال.</p></div>';
        return;
      }
      var all = [];
      wrap.innerHTML = rows.map(function (r) {
        remember(r.items);
        all = all.concat(r.items);
        return CS.ui.row(r.title, r.hint, r.items.slice(0, 20));
      }).join('');
      hydrateCerts(wrap, all);
    }).catch(function () {
      wrap.innerHTML = '<div class="empty">🔴 ما قدرت أجيب بيانات TMDB. تأكد من الاتصال.</div>';
    });
  }

  /* ============================================================
     النتائج
     ============================================================ */

  function currentFilters() {
    var active = $('.chip.is-active[data-filter-type]');
    return {
      type: active ? active.dataset.filterType : 'all',
      sort: $('#sort-by').value,
      minRating: +$('#min-rating').value || 0,
      yearFrom: +$('#year-from').value || 0,
      yearTo: +$('#year-to').value || 0
    };
  }

  function applyFilters(list) {
    var f = currentFilters();
    var out = list.filter(function (it) {
      if (f.type !== 'all' && it.type !== f.type) return false;
      if (f.minRating && (it.rating || 0) < f.minRating) return false;
      if (f.yearFrom && (!it.year || it.year < f.yearFrom)) return false;
      if (f.yearTo && (!it.year || it.year > f.yearTo)) return false;
      if (CS.certs.passes(it) === false) return false;
      return true;
    });

    var sorters = {
      relevance:  function (a, b) { return (b.score || 0) - (a.score || 0); },
      rating:     function (a, b) { return (b.rating || 0) - (a.rating || 0); },
      popularity: function (a, b) { return (b.popularity || 0) - (a.popularity || 0); },
      newest:     function (a, b) { return (b.year || 0) - (a.year || 0); },
      oldest:     function (a, b) { return (a.year || 9999) - (b.year || 9999); }
    };
    return out.sort(sorters[f.sort] || sorters.relevance);
  }

  function paintResults() {
    var grid = $('#results-grid');
    var empty = $('#results-empty');
    var more = $('#loadmore-wrap');

    /* الفلتر العمري يحتاج التصنيفات جاهزة قبل ما نقرر إيش نخفي */
    var pre = CS.certs.currentFilter() === 'all'
      ? Promise.resolve()
      : ensureCerts(CS.state.results, 80);

    pre.then(function () {
      var filtered = applyFilters(CS.state.results.slice());

      if (!filtered.length) {
        grid.innerHTML = '';
        empty.hidden = false;
        empty.innerHTML = CS.state.results.length
          ? '<b>🟡 الفلاتر ضيّقة</b><p>ما فيه نتيجة تطابق الفلاتر الحالية. اضغط «تصفير».</p>'
          : CS.ui.emptyHtml(CS.state.query, CS.state.meta || {});
        more.hidden = true;
        $('#results-meta').textContent = buildMetaText(0);
        return;
      }

      empty.hidden = true;
      var slice = filtered.slice(0, CS.state.shown);
      grid.innerHTML = CS.ui.cards(slice);
      more.hidden = filtered.length <= CS.state.shown;
      $('#results-meta').textContent = buildMetaText(filtered.length);
      hydrateCerts(grid, slice);
    });
  }

  function buildMetaText(count) {
    var m = CS.state.meta || {};
    var bits = [count + ' نتيجة'];
    var names = { title: 'بالاسم', plot: 'بوصف القصة', theme: 'بالثيمة', wikiTitle: 'بالاسم في ويكيبيديا' };
    if (m.engines && m.engines.length) {
      bits.push('محركات: ' + m.engines.map(function (e) { return names[e] || e; }).join(' + '));
    }
    if (m.translated) bits.push('جرّبت كمان بالإنجليزي: ' + m.translated);
    if (m.relatedOf) bits.push('+ أعمال قريبة من «' + m.relatedOf + '»');
    return bits.join(' · ');
  }

  var searchToken = 0;

  function doSearch(query, mode, skipHash) {
    query = String(query || '').trim();
    if (!query) return;

    mode = mode || CS.state.mode || 'auto';
    CS.state.query = query;
    CS.state.mode = mode;
    CS.store.set(CS.KEYS.mode, mode);
    CS.history.push(query);

    $('#q').value = query;
    setModeChip(mode);
    suggestOff = true;
    hideSuggest();
    showView('results');
    $('#results-title').textContent = '«' + query + '»';
    $('#results-meta').textContent = 'يدور…';
    $('#results-grid').innerHTML = CS.ui.skeletons(12);
    $('#results-empty').hidden = true;
    $('#loadmore-wrap').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!skipHash) {
      var h = '#/s/' + mode + '/' + encodeURIComponent(query);
      if (location.hash !== h) { suppressRoute = true; location.hash = h; }
    }

    var token = ++searchToken;

    CS.search.run(query, mode).then(function (res) {
      if (token !== searchToken) return;
      CS.state.results = res.items;
      CS.state.meta = res.meta;
      CS.state.shown = LIM.pageSize;
      remember(res.items);
      paintResults();
    }).catch(function (err) {
      if (token !== searchToken) return;
      $('#results-grid').innerHTML = '';
      $('#results-empty').hidden = false;
      $('#results-empty').innerHTML = '<b>🔴 صار خطأ في البحث</b><p>' +
        CS.util.esc(err && err.message === 'BAD_KEY' ? 'مفتاح TMDB غير صالح — عدّله من الإعدادات.' : 'تحقق من اتصالك وجرّب مرة ثانية.') + '</p>';
    });
  }

  /* ============================================================
     صفحة «عجبني»
     ============================================================ */

  function renderLiked() {
    showView('liked');
    var likes = CS.taste.likes();
    var dis = CS.taste.dislikes();
    remember(likes); remember(dis);

    $('#liked-grid').innerHTML = CS.ui.cards(likes);
    $('#liked-empty').hidden = likes.length > 0;
    $('#liked-meta').textContent = likes.length
      ? likes.length + ' عمل عجبك' + (dis.length ? ' · ' + dis.length + ' ما عجبك' : '')
      : '';

    $('#disliked-wrap').hidden = dis.length === 0;
    $('#disliked-grid').innerHTML = CS.ui.cards(dis);

    hydrateCerts($('#view-liked'), likes.concat(dis));
    updateLikeCount();
  }

  function updateLikeCount() {
    var n = CS.taste.counts().likes;
    var el = $('#fav-count');
    el.textContent = n;
    el.hidden = n === 0;
  }

  /* ============================================================
     صفحة العمل (صفحة كاملة، مو نافذة)
     ============================================================ */

  var detailToken = 0;
  var detailCtx = null;

  function repaintStory() {
    var sec = $('#dt-story');
    if (sec && detailCtx) sec.innerHTML = CS.ui.storySection(detailCtx.d, detailCtx.extra);
  }

  function openDetail(type, id) {
    var token = ++detailToken;
    showView('detail');
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    window.scrollTo(0, 0);

    CS.tmdb.details(type, id).then(function (d) {
      if (token !== detailToken) return;

      var extra = {};
      var arabic = d.overview && CS.util.isArabic(d.overview) ? d.overview : d.arOverview;

      if (CS.state.lang !== 'ar') {
        extra.summary = d.overview || d.enOverview || '';
        extra.summarySource = 'الملخص من TMDB';
      } else if (arabic) {
        extra.summary = arabic;
        extra.summarySource = 'الملخص من TMDB (عربي)';
      } else {
        extra.summary = d.enOverview || d.overview || '';
        extra.summarySource = 'الملخص من TMDB (إنجليزي)';
      }

      panel.innerHTML = CS.ui.detail(d, extra);
      remember([d]);
      remember(d.similar);
      remember(d.recommendations);
      window.scrollTo(0, 0);

      detailCtx = { d: d, extra: extra, token: token };
      CS.taste.enrich(d);   /* نغني ملف الذوق بالكلمات المفتاحية */

      hydrateCerts(panel, (d.similar || []).concat(d.recommendations || []));

      /* ما فيه ملخص عربي رسمي؟ نترجم الإنجليزي آليًا بالخلفية */
      if (CS.state.lang === 'ar' && !arabic && extra.summary) {
        CS.wiki.toArabic(extra.summary, 1200).then(function (ar) {
          if (!ar || token !== detailToken) return;
          extra.summary = ar;
          extra.summarySource = 'الملخص من TMDB (ترجمة آلية)';
          repaintStory();
        });
      }

      attachWikiPlot(d, extra, token);
      attachSources(d, token);
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🔴 ما قدرت أفتح التفاصيل</b><p>' +
        CS.util.esc(err && err.message === 'BAD_KEY' ? 'مفتاح TMDB غير صالح.' : 'جرّب مرة ثانية.') + '</p></div></div>';
    });
  }

  /* المصادر الإضافية: OMDb و TVmaze و Wikidata */
  function attachSources(d, token) {
    CS.sources.enrich(d).then(function (ex) {
      if (token !== detailToken) return;

      /* معرّفات ويكي داتا تحسّن الروابط الخارجية */
      if (ex.wikidata) {
        d.wd = ex.wikidata;
        if (!d.imdbId && ex.wikidata.imdb) d.imdbId = ex.wikidata.imdb;
        var linksSec = $('#dt-links');
        if (linksSec) linksSec.innerHTML = CS.ui.linksHtml(d);
      }

      var html = CS.ui.extraSources(d, ex);
      var slot = $('#dt-extra');
      if (slot && html) slot.innerHTML = html;
    }).catch(function () { /* المصادر الإضافية اختيارية */ });
  }

  /* يدوّر المقالة في ويكيبيديا العربية أول، وإذا ما لقى يجرّب الإنجليزية */
  function findArticle(d) {
    if (d.wikiTitle) {
      return Promise.resolve({ wikiLang: d.wikiLang || 'ar', wikiTitle: d.wikiTitle, wikiUrl: d.wikiUrl });
    }

    var names = [d.title, d.originalTitle, d.arTitle].filter(Boolean);
    var attempts = [
      { lang: 'ar', probe: (d.arTitle || d.title) + (d.year ? ' ' + d.year : '') },
      { lang: 'en', probe: (d.originalTitle || d.title) + (d.year ? ' ' + d.year : '') }
    ];

    return attempts.reduce(function (chain, a) {
      return chain.then(function (found) {
        if (found) return found;
        return CS.wiki.findWorks(a.lang, a.probe, 4).then(function (works) {
          var hit = works.filter(function (w) {
            var sim = Math.max.apply(null, names.map(function (n) {
              return CS.search.similarity(w.cleanTitle, n);
            }));
            return sim > .6 && (!w.year || !d.year || Math.abs(w.year - d.year) <= 1);
          })[0];
          return hit ? { wikiLang: hit.wikiLang, wikiTitle: hit.wikiTitle, wikiUrl: hit.wikiUrl } : null;
        }).catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }

  function attachWikiPlot(d, extra, token) {
    findArticle(d).then(function (w) {
      if (!w || token !== detailToken) return;
      return CS.wiki.fullPlot(w.wikiLang, w.wikiTitle).then(function (plot) {
        if (!plot || token !== detailToken) return;
        d.wikiUrl = d.wikiUrl || w.wikiUrl;
        d.wikiTitle = w.wikiTitle;
        d.wikiLang = w.wikiLang;
        extra.fullPlot = plot;
        extra.plotLang = w.wikiLang;
        repaintStory();
      });
    }).catch(function () { /* القصة الكاملة اختيارية */ });
  }

  /* ترجمة القصة الطويلة عند الطلب — تستهلك حصة MyMemory اليومية */
  function translatePlot(btn) {
    if (!detailCtx || !detailCtx.extra.fullPlot) return;
    var ctx = detailCtx;
    btn.disabled = true;
    btn.textContent = '⏳ يترجم…';

    CS.wiki.toArabic(ctx.extra.fullPlot, 3000).then(function (ar) {
      if (ctx.token !== detailToken) return;
      if (ar) {
        ctx.extra.plotArabic = ar;
        ctx.extra.plotError = '';
      } else {
        ctx.extra.plotError = 'ما قدرت أترجم — غالبًا انتهت الحصة اليومية المجانية للترجمة. جرّب بكرة، أو حط بريدك في الإعدادات عشان يرتفع الحد.';
      }
      repaintStory();
    });
  }

  function openWikiDetail(lang, title) {
    var token = ++detailToken;
    showView('detail');
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    window.scrollTo(0, 0);

    var cached = itemCache['w/' + lang + '/' + title];

    CS.wiki.fullPlot(lang, title).then(function (plot) {
      if (token !== detailToken) return;
      var d = cached || {
        id: 'w', type: 'movie', title: CS.util.cleanTitle(title), year: null,
        poster: '', source: 'wiki', overview: '',
        wikiLang: lang, wikiTitle: title,
        wikiUrl: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title)
      };
      var extra = {
        summary: d.overview || '',
        summarySource: 'الملخص من ويكيبيديا',
        fullPlot: plot,
        plotLang: lang
      };
      panel.innerHTML = CS.ui.detail(d, extra);
      window.scrollTo(0, 0);
      detailCtx = { d: d, extra: extra, token: token };
    }).catch(function () {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty">🔴 ما قدرت أجيب المقالة من ويكيبيديا.</div></div>';
    });
  }

  /* ============================================================
     الإعدادات
     ============================================================ */

  function openSettings() {
    $('#api-key').value = CS.state.userKey || '';
    $('#omdb-key').value = CS.store.get(CS.KEYS.omdbKey, '') || '';
    $('#tr-email').value = CS.store.get(CS.KEYS.email, '') || '';
    $('#set-lang').value = CS.state.lang;
    $('#set-region').value = CS.state.region;
    $('#key-state').className = 'keystate';
    $('#settings').hidden = false;
    document.body.classList.add('is-locked');
    setTimeout(function () { $('#api-key').focus(); }, 60);
  }

  function closeSettings() {
    $('#settings').hidden = true;
    document.body.classList.remove('is-locked');
  }

  function finishSave() {
    setTimeout(function () {
      closeSettings();
      CS.ui.toast('🟢 تم الحفظ');
      if (CS.state.view === 'results' && CS.state.query) doSearch(CS.state.query, CS.state.mode, true);
      else if (CS.state.view === 'liked') renderLiked();
      else if (CS.state.view === 'home') renderHome();
    }, 700);
  }

  function saveSettings() {
    var key = $('#api-key').value.trim();
    var omdb = $('#omdb-key').value.trim();
    var email = $('#tr-email').value.trim();
    var lang = $('#set-lang').value;
    var region = $('#set-region').value;
    var state = $('#key-state');

    CS.state.lang = CS.store.set(CS.KEYS.lang, lang);
    CS.state.region = CS.store.set(CS.KEYS.region, region);
    $('#lang-label').textContent = lang === 'ar' ? 'ع' : 'EN';

    if (email) CS.store.set(CS.KEYS.email, email); else CS.store.remove(CS.KEYS.email);
    if (omdb) CS.store.set(CS.KEYS.omdbKey, omdb); else CS.store.remove(CS.KEYS.omdbKey);

    if (!key) {
      CS.state.userKey = '';
      CS.state.apiKey = CS.config.sharedKey;
      CS.store.remove(CS.KEYS.apiKey);
      state.className = 'keystate is-ok';
      state.textContent = '🟢 محفوظ. الموقع يستخدم المفتاح المشترك المدمج.';
      refreshKeyNotice();
      CS.tmdb.loadGenres().then(finishSave);
      return;
    }

    state.className = 'keystate is-wait';
    state.textContent = '⏳ أختبر المفتاح…';

    CS.tmdb.testKey(key).then(function () {
      CS.state.userKey = CS.store.set(CS.KEYS.apiKey, key);
      CS.state.apiKey = key;
      state.className = 'keystate is-ok';
      state.textContent = '🟢 مفتاحك الخاص شغّال ومفعّل.';
      refreshKeyNotice();
      return CS.tmdb.loadGenres();
    }).then(finishSave).catch(function (err) {
      state.className = 'keystate is-bad';
      state.textContent = err && err.message === 'BAD_KEY'
        ? '🔴 المفتاح مرفوض من TMDB. تأكد إنك ناسخ مفتاح v3 أو توكن v4 كامل.'
        : '🔴 ما قدرت أتحقق من المفتاح — تحقق من الاتصال.';
    });
  }

  function refreshKeyNotice() {
    var off = CS.store.get(CS.KEYS.noticeOff, false);
    $('#key-notice').hidden = CS.hasKey() || off;
  }

  /* ============================================================
     فلتر التصنيف العمري
     ============================================================ */

  function setCertFilter(value) {
    /* الإباحي يحتاج موافقة صريحة مرة وحدة */
    if (value === 'adult' && !CS.store.get(CS.KEYS.adultOn, false)) {
      var ok = window.confirm(
        'تبي تشغّل عرض المحتوى الإباحي الصريح (18+ بدون تغطية)؟\n\n' +
        'هذا يفعّل include_adult في TMDB ويعرض أعمالًا للبالغين فقط. ' +
        'تقدر تطفيه في أي وقت من نفس القائمة.'
      );
      if (!ok) { $('#cert-filter').value = CS.certs.currentFilter(); return; }
      CS.store.set(CS.KEYS.adultOn, true);
    }
    if (value !== 'adult') CS.store.set(CS.KEYS.adultOn, false);

    CS.store.set(CS.KEYS.certTier, value);
    CS.state.shown = LIM.pageSize;

    if (CS.state.view === 'results' && CS.state.query) doSearch(CS.state.query, CS.state.mode, true);
    else if (CS.state.view === 'home') renderHome();
    else if (CS.state.view === 'liked') renderLiked();
  }

  /* ============================================================
     الاقتراحات الفورية
     ============================================================ */

  var suggestToken = 0;
  var suggestOff = false;

  function hideSuggest() {
    suggestToken++;
    var s = $('#suggest');
    s.hidden = true;
    s.innerHTML = '';
  }

  var runSuggest = CS.util.debounce(function (q) {
    if (suggestOff || q.length < 2 || !CS.hasKey()) return hideSuggest();
    var token = ++suggestToken;

    CS.search.suggest(q).then(function (list) {
      if (token !== suggestToken || !list.length) return hideSuggest();
      remember(list);
      var s = $('#suggest');
      s.innerHTML = list.map(function (it) {
        var img = it.poster
          ? '<img src="' + CS.util.esc(it.poster) + '" alt="" loading="lazy">'
          : '<span class="sug__ph">' + (it.type === 'tv' ? '📺' : '🎬') + '</span>';
        return '<button type="button" class="sug" data-open="' + CS.util.esc(CS.ui.itemKey(it)) + '">' + img +
          '<span class="sug__t"><b>' + CS.util.esc(it.title) + '</b>' +
          '<span>' + [it.year, CS.ui.TYPE_AR[it.type]].filter(Boolean).join(' · ') + '</span></span></button>';
      }).join('');
      s.hidden = false;
    }).catch(hideSuggest);
  }, 320);

  /* ============================================================
     التوجيه
     ============================================================ */

  var suppressRoute = false;

  function parseHash() {
    var h = location.hash.slice(1).replace(/^\//, '');
    if (!h) return { name: 'home' };
    var parts = h.split('/');

    if (parts[0] === 's' && parts.length >= 3) {
      return { name: 'search', mode: parts[1], query: decodeURIComponent(parts.slice(2).join('/')) };
    }
    /* #/work/movie/550 · #/work/w/ar/العنوان */
    if (parts[0] === 'work') parts = parts.slice(1);

    if ((parts[0] === 'movie' || parts[0] === 'tv') && parts[1]) {
      return { name: 'detail', type: parts[0], id: parts[1] };
    }
    if (parts[0] === 'w' && parts.length >= 3) {
      return { name: 'wiki', lang: parts[1], title: decodeURIComponent(parts.slice(2).join('/')) };
    }
    if (parts[0] === 'liked' || parts[0] === 'fav') return { name: 'liked' };
    return { name: 'home' };
  }

  function onRoute() {
    if (suppressRoute) { suppressRoute = false; return; }
    var r = parseHash();

    if (r.name !== 'detail' && r.name !== 'wiki') detailToken++;

    if (r.name === 'detail') { CS.state.backTo = CS.state.backTo || '#/'; openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { CS.state.backTo = CS.state.backTo || '#/'; openWikiDetail(r.lang, r.title); return; }

    CS.state.backTo = location.hash || '#/';

    if (r.name === 'search') { doSearch(r.query, r.mode, true); return; }
    if (r.name === 'liked')  { renderLiked(); return; }
    renderHome();
  }

  function goDetail(key) {
    suggestOff = true;
    hideSuggest();
    var here = parseHash().name;
    if (here !== 'detail' && here !== 'wiki') CS.state.backTo = location.hash || '#/';
    location.hash = '#/work/' + key;
  }

  function goBack() {
    if (history.length > 1) { history.back(); return; }
    location.hash = CS.state.backTo || '#/';
  }

  /* ============================================================
     أوضاع البحث
     ============================================================ */

  function setModeChip(mode) {
    $$('.chip[data-mode]').forEach(function (c) {
      var on = c.dataset.mode === mode;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /* ============================================================
     التصويت (عجبني / ما عجبني)
     ============================================================ */

  function handleVote(btn) {
    var item = itemCache[btn.dataset.item];
    if (!item) return;
    var dir = +btn.dataset.vote;
    var now = CS.taste.set(item, dir);

    CS.ui.toast(now === 1 ? '👍 انضاف لذوقك — بتشوف شبيهه في الاستكشاف'
              : now === -1 ? '👎 تمام، ما بكرّر لك شبيهه'
              : '⚪ شلت رأيك');

    /* نحدّث كل أزرار نفس العمل في الصفحة */
    $$('[data-item="' + attrEsc(btn.dataset.item) + '"]').forEach(function (b) {
      var on = +b.dataset.vote === now;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    updateLikeCount();
    if (CS.state.view === 'liked') renderLiked();
  }

  /* ============================================================
     ربط الأحداث
     ============================================================ */

  function bind() {

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#q').value.trim();
      if (q) doSearch(q, CS.state.mode);
    });

    $('#q').addEventListener('input', function () {
      var v = this.value.trim();
      $('#search-clear').hidden = !v;
      suggestOff = false;
      runSuggest(v);
    });

    $('#q').addEventListener('focus', function () {
      if (this.value.trim().length >= 2) runSuggest(this.value.trim());
    });

    $('#search-clear').addEventListener('click', function () {
      $('#q').value = '';
      this.hidden = true;
      hideSuggest();
      $('#q').focus();
    });

    $$('.chip[data-mode]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        CS.state.mode = chip.dataset.mode;
        CS.store.set(CS.KEYS.mode, CS.state.mode);
        setModeChip(CS.state.mode);
        var q = $('#q').value.trim();
        if (q) doSearch(q, CS.state.mode);
      });
    });

    $('#hero-examples').addEventListener('click', function (e) {
      var b = e.target.closest('[data-example]');
      if (!b) return;
      doSearch(b.dataset.example, 'plot');
    });

    /* --- الفلاتر --- */
    $('#filters').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter-type]');
      if (!b) return;
      $$('[data-filter-type]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      CS.state.shown = LIM.pageSize;
      paintResults();
    });

    ['#sort-by', '#min-rating', '#year-from', '#year-to'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        CS.state.shown = LIM.pageSize;
        paintResults();
      });
    });

    $$('.cert-filter').forEach(function (sel) {
      sel.addEventListener('change', function () {
        $$('.cert-filter').forEach(function (o) { o.value = sel.value; });
        setCertFilter(sel.value);
      });
    });

    $('#btn-reset-filters').addEventListener('click', function () {
      $$('[data-filter-type]').forEach(function (x) { x.classList.toggle('is-active', x.dataset.filterType === 'all'); });
      $('#sort-by').value = 'relevance';
      $('#min-rating').value = '0';
      $('#year-from').value = '';
      $('#year-to').value = '';
      CS.state.shown = LIM.pageSize;
      paintResults();
    });

    $('#btn-loadmore').addEventListener('click', function () {
      CS.state.shown += LIM.pageSize;
      paintResults();
    });

    /* --- تفويض النقر العام --- */
    document.addEventListener('click', function (e) {
      var vote = e.target.closest('[data-vote]');
      if (vote) { e.preventDefault(); handleVote(vote); return; }

      var open = e.target.closest('[data-open]');
      if (open) { e.preventDefault(); goDetail(open.dataset.open); return; }

      var trBtn = e.target.closest('[data-translate-plot]');
      if (trBtn) { translatePlot(trBtn); return; }

      var share = e.target.closest('[data-share]');
      if (share) {
        var url = location.origin + location.pathname + '#/work/' + share.dataset.share;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { CS.ui.toast('🔗 انتسخ الرابط'); });
        } else {
          CS.ui.toast(url);
        }
        return;
      }

      if (e.target.closest('[data-back]')) { goBack(); return; }
      if (e.target.closest('[data-close-settings]')) { closeSettings(); return; }
      if (e.target.closest('[data-route-home]')) { e.preventDefault(); location.hash = '#/'; return; }

      if (e.target.id === 'btn-reset-taste') {
        if (window.confirm('أصفّر كل الإعجابات وأرجع الاستكشاف من الصفر؟')) {
          CS.taste.clearAll();
          updateLikeCount();
          renderHome();
          CS.ui.toast('⚪ انصفّر ذوقك');
        }
        return;
      }

      if (!e.target.closest('#search-form')) hideSuggest();
    });

    /* --- أزرار الهيدر --- */
    $('#btn-fav').addEventListener('click', function () { location.hash = '#/liked'; });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#notice-open-settings').addEventListener('click', openSettings);

    $('#notice-dismiss').addEventListener('click', function () {
      CS.store.set(CS.KEYS.noticeOff, true);
      $('#key-notice').hidden = true;
    });

    $('#btn-lang').addEventListener('click', function () {
      CS.state.lang = CS.store.set(CS.KEYS.lang, CS.state.lang === 'ar' ? 'en' : 'ar');
      $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';
      CS.ui.toast(CS.state.lang === 'ar' ? '🟢 لغة المحتوى: العربية' : '🟢 Content language: English');
      CS.tmdb.loadGenres().then(function () {
        if (CS.state.view === 'results' && CS.state.query) doSearch(CS.state.query, CS.state.mode, true);
        else if (CS.state.view === 'home') renderHome();
      });
    });

    $('#btn-back-home').addEventListener('click', function () { location.hash = '#/'; });
    $('#btn-liked-back').addEventListener('click', function () { location.hash = '#/'; });

    /* --- الإعدادات --- */
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#btn-clear-key').addEventListener('click', function () {
      $('#api-key').value = '';
      CS.state.userKey = '';
      CS.state.apiKey = CS.config.sharedKey;
      CS.store.remove(CS.KEYS.apiKey);
      refreshKeyNotice();
      $('#key-state').className = 'keystate is-ok';
      $('#key-state').textContent = '🟢 انحذف مفتاحك الخاص. رجعنا للمفتاح المشترك.';
    });

    /* --- الاختصارات --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#settings').hidden) return closeSettings();
        if (CS.state.view === 'detail') return goBack();
        hideSuggest();
        return;
      }
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    });

    window.addEventListener('hashchange', onRoute);
  }

  /* ============================================================
     الإقلاع
     ============================================================ */

  function boot() {
    var moved = CS.taste.migrate();   /* المفضلة القديمة تصير إعجابات */
    $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';
    setModeChip(CS.state.mode);
    updateLikeCount();
    if (moved) setTimeout(function () { CS.ui.toast('👍 نقلت ' + moved + ' من مفضلتك القديمة'); }, 900);
    refreshKeyNotice();
    $$('.cert-filter').forEach(function (s) { s.value = CS.certs.currentFilter(); });
    bind();

    var start = CS.hasKey() ? CS.tmdb.loadGenres().catch(function () {}) : Promise.resolve();
    start.then(onRoute);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.CS);
