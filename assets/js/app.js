/* ============================================================
   app.js — RANHUB: التوجيه، الأحداث، وربط كل شي مع بعض
   الصفحات: الاستكشاف · النتائج · العمل · الشخص · عجبني
   ============================================================ */

(function (CS) {
  'use strict';

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* لو config.js نفسه هو الملف القديم/الفاشل، لازم app.js يكمل تحميله
     عشان يقدر يعرض شريط «نسختك قديمة» بدل ما يموت بصمت */
  var LIM = (CS.config && CS.config.limits) ||
            { pageSize: 50, suggest: 7, history: 12, wikiSearch: 14, wikiResolve: 10, keywordSeeds: 3 };

  var PAGE = 50;                /* كم عمل نضيف مع كل «اعرض المزيد» */
  var itemCache = {};

  function remember(list) {
    (list || []).forEach(function (it) { if (it) itemCache[CS.ui.itemKey(it)] = it; });
  }

  function attrEsc(v) { return String(v).replace(/(["\\])/g, '\\$1'); }

  function esc0(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* الحافظة تُرفض في سفاري والسياقات غير الآمنة — لازم بديل ما يفشل بصمت */
  function copyLink(url) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        CS.ui.toast(ok ? '🔗 انتسخ الرابط' : url);
      } catch (e) { CS.ui.toast(url); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { CS.ui.toast('🔗 انتسخ الرابط'); }).catch(fallback);
      return;
    }
    fallback();
  }

  /* ============================================================
     الصفحات
     ============================================================ */

  var VIEWS = ['home', 'results', 'liked', 'detail', 'person'];

  function showView(name) {
    CS.state.view = name;
    VIEWS.forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
  }

  /* ============================================================
     التصنيف ووسوم المحتوى — تحميل كسول
     ============================================================ */

  function ensureCerts(list, cap) {
    var need = (list || []).slice(0, cap || 60).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedFor(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchFor(it); });
  }

  /* وسوم المحتوى تُسحب فقط في أقسام الكبار — فيها الفائدة، وتوفّر طلبات */
  function ensureHeat(list, cap) {
    if (!CS.certs.matureOnly()) return Promise.resolve();
    var need = (list || []).slice(0, cap || 40).filter(function (it) {
      return it.source === 'tmdb' && CS.certs.cachedHeat(it) === undefined;
    });
    if (!need.length) return Promise.resolve();
    return CS.util.pool(need, 6, function (it) { return CS.certs.fetchHeat(it); });
  }

  function paintBadges(root, list) {
    (list || []).forEach(function (it) {
      var cardEl = root.querySelector('.card[data-key="' + attrEsc(CS.ui.itemKey(it)) + '"]');
      if (!cardEl) return;
      var poster = cardEl.querySelector('.card__poster');
      if (!poster) return;

      var info = CS.certs.cachedFor(it);
      if (info && !poster.querySelector('.card__cert')) {
        poster.insertAdjacentHTML('beforeend', CS.ui.certBadge(it));
      }
      var heat = CS.certs.cachedHeat(it);
      if (heat && heat.score && !poster.querySelector('.card__heat')) {
        it.heat = heat;
        poster.insertAdjacentHTML('beforeend',
          '<div class="card__heat" title="' + attrEsc('وسوم TMDB: ' + heat.tags.join('، ')) +
          '"><i style="width:' + heat.score + '%"></i></div>');
      }
    });
  }

  function hydrate(root, list) {
    Promise.all([ensureCerts(list), ensureHeat(list)])
      .then(function () { paintBadges(root, list); });
  }

  /* ============================================================
     الاستكشاف — شبكة واحدة بترقيم لا نهائي
     ============================================================ */

  var TABS = {
    all:      { title: '✨ كل الأعمال',   cert: 'all' },
    movie:    { title: '🎬 أفلام',        cert: 'all' },
    tv:       { title: '📺 مسلسلات',      cert: 'all' },
    reality:  { title: '🎤 برامج واقعية', cert: 'all' },
    doc:      { title: '🎥 وثائقي',       cert: 'all' },
    mature:   { title: '🔞 +18 — تصنيف رسمي', cert: 'mature' },
    erotic:   { title: '🌶️ إيروتيك',      cert: 'erotic' },
    explicit: { title: '⛔ إباحي صريح',   cert: 'explicit' }
  };

  var feedBusy = false;

  function currentTab() {
    var el = $('.tab.is-active');
    return el ? el.dataset.tab : 'all';
  }

  function startFeed(tab) {
    var conf = TABS[tab] || TABS.all;

    /* أقسام الكبار تحتاج موافقة صريحة مرة وحدة */
    if (conf.cert !== 'all' && !CS.store.get(CS.KEYS.adultOn, false)) {
      var ok = window.confirm(
        'قسم للبالغين فقط (+18)\n\n' +
        'هذا القسم يعرض محتوى مصنّف +18 فقط، وما يعرض شي عام.\n' +
        'تأكد إنك بالغ وإن استخدامه مسؤوليتك. تبي تفتحه؟'
      );
      if (!ok) { setTab('all'); return; }
      CS.store.set(CS.KEYS.adultOn, true);
    }

    CS.store.set(CS.KEYS.certTier, conf.cert);
    CS.store.set(CS.KEYS.tab, tab);

    $('#feed-title').textContent = conf.title;
    $('#age-warn').hidden = conf.cert === 'all';

    CS.feed.reset({
      tab: tab,
      sort: $('#feed-sort').value,
      origLang: $('#feed-lang').value,
      minRating: +$('#feed-rating').value || 0
    });

    $('#feed-grid').innerHTML = CS.ui.skeletons(18);
    $('#feed-empty').hidden = true;
    $('#feed-more').hidden = true;
    loadFeed(true);
  }

  function setTab(tab) {
    $$('.tab').forEach(function (t) {
      var on = t.dataset.tab === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function loadFeed(first) {
    if (feedBusy) return;
    feedBusy = true;
    var btn = $('#btn-feed-more');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ يحمّل…'; }

    CS.feed.loadMore().then(function (res) {
      feedBusy = false;
      if (CS.state.view !== 'home') return;

      var items = res.items;
      remember(items);

      if (!items.length) {
        $('#feed-grid').innerHTML = '';
        $('#feed-empty').hidden = false;
        $('#feed-empty').innerHTML = emptyFeedHtml();
        $('#feed-more').hidden = true;
        return;
      }

      $('#feed-empty').hidden = true;
      $('#feed-grid').innerHTML = CS.ui.cards(items);
      $('#feed-count').textContent = items.length + ' عمل' + (res.exhausted ? ' — خلصت المادة' : '');
      $('#feed-more').hidden = res.exhausted;
      if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
      hydrate($('#feed-grid'), items);
      if (first) window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (err) {
      feedBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'اعرض المزيد'; }
      if (CS.state.view !== 'home') return;
      var why = err && err.message === 'NO_KEY' ? 'ما فيه مفتاح TMDB' : CS.tmdb.explain(err);
      showTmdbProblem(why);
      $('#feed-grid').innerHTML = '';
      $('#feed-empty').hidden = false;
      $('#feed-empty').innerHTML =
        '<b>🔴 ما قدرت أوصل لـ TMDB</b><p>' + esc0(why) + '</p>' +
        '<div style="margin-top:1.2rem;display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn" data-diagnose>🔍 افحص الاتصال</button>' +
        '<button class="btn btn--ghost" data-retry-home>أعد المحاولة</button></div>';
    });
  }

  function emptyFeedHtml() {
    var tab = currentTab();
    if (tab === 'explicit') {
      return '<b>⛔ قسم الإباحي الصريح</b>' +
        '<p>TMDB ما يوفّر تصفّحًا لهذا المحتوى — ما فيه أي معامل يطلب «الإباحي فقط»، ' +
        'وأغلب هذي الأعمال بلا بوستر ولا ملخّص أصلًا.</p>' +
        '<p style="margin-top:.8rem">الطريقة الوحيدة اللي تشتغل: <b>ابحث باسم صريح</b> من الخانة فوق.</p>';
    }
    return '<b>🟡 ما فيه شي في هذا القسم</b>' +
      '<p>جرّب توسّع الفلاتر — رجّع «اللغة الأصلية» لـ«كل اللغات» و«أقل تقييم» لـ«أي تقييم».</p>' +
      '<div style="margin-top:1.2rem"><button class="btn" data-tab-all>رجّعني لقسم الكل</button></div>';
  }

  /* ============================================================
     النتائج
     ============================================================ */

  var searchToken = 0;

  function paintResults() {
    var grid = $('#results-grid');
    var empty = $('#results-empty');
    var more = $('#loadmore-wrap');
    var all = CS.state.results;

    var pre = CS.certs.currentFilter() === 'all' ? Promise.resolve() : ensureCerts(all, 150);

    pre.then(function () {
      var list = all.filter(function (it) {
        if (CS.certs.currentFilter() === 'all') return CS.certs.passes(it) !== false;
        return CS.certs.passes(it) === true;
      });

      if (!list.length) {
        grid.innerHTML = '';
        empty.hidden = false;
        var meta = CS.state.meta || {};
        if (CS.certs.currentFilter() !== 'all') meta.certFiltered = CS.certs.current().label;
        else delete meta.certFiltered;
        empty.innerHTML = CS.ui.emptyHtml(CS.state.query, meta);
        more.hidden = true;
        $('#results-meta').textContent = buildMetaText(0);
        return;
      }

      empty.hidden = true;
      var slice = list.slice(0, CS.state.shown);
      grid.innerHTML = CS.ui.cards(slice);
      more.hidden = list.length <= CS.state.shown;
      $('#results-count').textContent = slice.length + ' من ' + list.length;
      $('#results-meta').textContent = buildMetaText(list.length);
      hydrate(grid, slice);
    });
  }

  function buildMetaText(count) {
    var m = CS.state.meta || {};
    var bits = [count + ' نتيجة'];
    if (m.translated) bits.push('جرّبت كمان بالإنجليزي: ' + m.translated);
    if (m.relatedOf) bits.push('+ أعمال قريبة من «' + m.relatedOf + '»');
    if (m.tmdbError) bits.push('🔴 TMDB ما رد: ' + m.tmdbError);
    return bits.join(' · ');
  }

  function doSearch(query, skipHash) {
    query = String(query || '').trim();
    if (!query) { location.hash = '#/'; return; }

    CS.state.query = query;
    CS.history.push(query);

    $('#q').value = query;
    $('#btn-to-en').hidden = !CS.util.isArabic(query);
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
      var h = '#/s/' + encodeURIComponent(query);
      if (location.hash !== h) { suppressRoute = true; location.hash = h; }
    }

    var token = ++searchToken;

    CS.search.run(query).then(function (res) {
      if (token !== searchToken) return;
      CS.state.results = res.items;
      CS.state.meta = res.meta;
      CS.state.shown = PAGE;
      remember(res.items);
      if (res.meta.tmdbError) showTmdbProblem(res.meta.tmdbError); else refreshKeyNotice();
      paintResults();
    }).catch(function (err) {
      if (token !== searchToken) return;
      $('#results-grid').innerHTML = '';
      $('#results-empty').hidden = false;
      $('#results-empty').innerHTML = '<b>🔴 صار خطأ في البحث</b><p>' + esc0(CS.tmdb.explain(err)) + '</p>';
    });
  }

  /* حوّل بحثي للإنجليزي */
  function searchInEnglish() {
    var q = $('#q').value.trim();
    if (!q) return;
    var btn = $('#btn-to-en');
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = '⏳';

    CS.wiki.toEnglish(q).then(function (en) {
      btn.disabled = false;
      btn.textContent = was;
      if (!en || en === q) { CS.ui.toast('🟡 ما قدرت أترجم — جرّب بعدين'); return; }
      CS.ui.toast('🔤 ' + en);
      doSearch(en);
    });
  }

  /* ============================================================
     اللي عجبني + التصدير والاستيراد
     ============================================================ */

  function renderLiked() {
    showView('liked');
    var likes = CS.taste.likes();
    var dis = CS.taste.dislikes();
    remember(likes); remember(dis);

    $('#liked-grid').innerHTML = CS.ui.cards(likes);
    $('#liked-empty').hidden = likes.length > 0 || dis.length > 0;
    $('#liked-meta').textContent = (likes.length || dis.length)
      ? likes.length + ' عمل عجبك' + (dis.length ? ' · ' + dis.length + ' ما عجبك' : '') : '';

    $('#disliked-wrap').hidden = dis.length === 0;
    $('#disliked-grid').innerHTML = CS.ui.cards(dis);

    hydrate($('#view-liked'), likes.concat(dis));
    updateLikeCount();
  }

  function updateLikeCount() {
    var n = CS.taste.counts().likes;
    var el = $('#fav-count');
    el.textContent = n;
    el.hidden = n === 0;
  }

  function exportTaste() {
    var data = {
      app: 'RANHUB', version: CS.config.version, exportedAt: new Date().toISOString(),
      likes: CS.taste.likes(), dislikes: CS.taste.dislikes()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ranhub-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    CS.ui.toast('⬇️ نزّلت ' + data.likes.length + ' إعجاب');
  }

  function importTaste(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var added = CS.taste.merge(data);
        CS.ui.toast(added ? '⬆️ ضفت ' + added + ' عمل' : '🟡 ما فيه شي جديد في الملف');
        renderLiked();
      } catch (e) {
        CS.ui.toast('🔴 الملف مو صالح — لازم يكون ملف تصدير من RANHUB');
      }
    };
    reader.onerror = function () { CS.ui.toast('🔴 ما قدرت أقرأ الملف'); };
    reader.readAsText(file);
  }

  /* ============================================================
     صفحة العمل
     ============================================================ */

  var detailToken = 0;
  var detailCtx = null;
  var related = { items: [], page: 0, exhausted: false, loading: false };

  function repaintStory() {
    var sec = $('#dt-story');
    if (sec && detailCtx) sec.innerHTML = CS.ui.storySection(detailCtx.d, detailCtx.extra);
  }

  function autoTranslateOn() { return CS.store.get(CS.KEYS.autoTr, true) !== false; }

  function openDetail(type, id) {
    var token = ++detailToken;
    showView('detail');
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    window.scrollTo(0, 0);
    related = { items: [], page: 0, exhausted: false, loading: false };

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
        if (autoTranslateOn() && extra.summary) extra.translating = true;
      }

      panel.innerHTML = CS.ui.detail(d, extra);
      remember([d]);
      window.scrollTo(0, 0);
      detailCtx = { d: d, extra: extra, token: token };
      CS.taste.enrich(d);

      if (CS.state.lang === 'ar' && !arabic && extra.summary && autoTranslateOn()) {
        CS.wiki.toArabic(extra.summary, 1200).then(function (ar) {
          if (token !== detailToken) return;
          extra.translating = false;
          if (ar) { extra.summary = ar; extra.summarySource = 'الملخص من TMDB (ترجمة آلية)'; }
          repaintStory();
        });
      }

      attachWikiPlot(d, extra, token);
      attachSources(d, token);
      loadRelated(d, token, true);
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🔴 ما قدرت أفتح التفاصيل</b><p>' +
        esc0(CS.tmdb.explain(err)) + '</p></div></div>';
    });
  }

  /* الأعمال ذات الصلة: مشابهات + ترشيحات، صفحة صفحة وبلا تكرار */
  function loadRelated(d, token, first) {
    if (related.loading || related.exhausted) return;
    related.loading = true;
    if (!first) {
      var sec = $('#dt-related');
      if (sec) sec.innerHTML = CS.ui.relatedSection(related.items, related.exhausted, true);
    }

    related.page += 1;
    var p = related.page;

    Promise.all([
      CS.tmdb.relatedPage(d.type, d.id, 'recommendations', p),
      CS.tmdb.relatedPage(d.type, d.id, 'similar', p)
    ]).then(function (r) {
      if (token !== detailToken) return;
      related.loading = false;

      var seen = {};
      related.items.forEach(function (x) { seen[x.type + ':' + x.id] = true; });
      seen[d.type + ':' + d.id] = true;

      var added = 0;
      r[0].items.concat(r[1].items).forEach(function (it) {
        var k = it.type + ':' + it.id;
        if (seen[k] || !it.poster) return;
        if (it.adult && !CS.certs.adultAllowed()) return;
        seen[k] = true;
        related.items.push(it);
        added++;
      });

      if (p >= Math.max(r[0].pages, r[1].pages) || (!added && p > 1)) related.exhausted = true;

      remember(related.items);
      var sec2 = $('#dt-related');
      if (sec2) {
        sec2.innerHTML = CS.ui.relatedSection(related.items, related.exhausted, false);
        hydrate(sec2, related.items);
      }
      /* الصفحة الأولى قد ترجع قليلًا — نكمل تلقائيًا لين نوصل عددًا محترمًا */
      if (first && related.items.length < 20 && !related.exhausted) loadRelated(d, token, true);
    }).catch(function () { related.loading = false; });
  }

  function attachSources(d, token) {
    CS.sources.enrich(d).then(function (ex) {
      if (token !== detailToken) return;
      if (ex.wikidata) {
        d.wd = ex.wikidata;
        if (!d.imdbId && ex.wikidata.imdb) d.imdbId = ex.wikidata.imdb;
        var linksSec = $('#dt-links');
        if (linksSec) linksSec.innerHTML = CS.ui.linksHtml(d);
      }
      var html = CS.ui.extraSources(d, ex);
      var slot = $('#dt-extra');
      if (slot && html) slot.innerHTML = html;
    }).catch(function () { /* اختيارية */ });
  }

  function findArticle(d) {
    if (d.wikiTitle) return Promise.resolve({ wikiLang: d.wikiLang || 'ar', wikiTitle: d.wikiTitle, wikiUrl: d.wikiUrl });

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
            var sim = Math.max.apply(null, names.map(function (n) { return CS.search.similarity(w.cleanTitle, n); }));
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

        /* ترجمة تلقائية للقصة الطويلة لو الإعداد مفعّل */
        if (CS.state.lang === 'ar' && autoTranslateOn() && !CS.util.isArabic(plot)) {
          extra.translating = true;
          repaintStory();
          CS.wiki.toArabic(plot, 3000).then(function (ar) {
            if (token !== detailToken) return;
            extra.translating = false;
            if (ar) extra.plotArabic = ar;
            else extra.plotError = 'ما قدرت أترجم القصة — غالبًا انتهت الحصة اليومية المجانية. حط بريدك في الإعدادات عشان يرتفع الحد.';
            repaintStory();
          });
          return;
        }
        repaintStory();
      });
    }).catch(function () { /* اختيارية */ });
  }

  function translatePlot(btn) {
    if (!detailCtx || !detailCtx.extra.fullPlot) return;
    var ctx = detailCtx;
    btn.disabled = true;
    btn.textContent = '⏳ يترجم…';

    CS.wiki.toArabic(ctx.extra.fullPlot, 3000).then(function (ar) {
      if (ctx.token !== detailToken) return;
      if (ar) { ctx.extra.plotArabic = ar; ctx.extra.plotError = ''; }
      else ctx.extra.plotError = 'ما قدرت أترجم — غالبًا انتهت الحصة اليومية المجانية للترجمة.';
      repaintStory();
    });
  }

  function openWikiDetail(lang, title) {
    var token = ++detailToken;
    showView('detail');
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    window.scrollTo(0, 0);

    var cached = itemCache['w/' + lang + '/' + encodeURIComponent(title)] ||
                 itemCache['w/' + lang + '/' + title];

    CS.wiki.fullPlot(lang, title).then(function (plot) {
      if (token !== detailToken) return;
      var d = cached || {
        id: 'w', type: 'movie', title: CS.util.cleanTitle(title), year: null,
        poster: '', source: 'wiki', overview: '',
        wikiLang: lang, wikiTitle: title,
        wikiUrl: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title)
      };
      var extra = { summary: d.overview || '', summarySource: 'الملخص من ويكيبيديا', fullPlot: plot, plotLang: lang };
      remember([d]);
      panel.innerHTML = CS.ui.detail(d, extra);
      window.scrollTo(0, 0);
      detailCtx = { d: d, extra: extra, token: token };
    }).catch(function () {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty">🔴 ما قدرت أجيب المقالة من ويكيبيديا.</div></div>';
    });
  }

  /* ============================================================
     صفحة الشخص
     ============================================================ */

  var personCtx = null;

  function openPerson(id) {
    var token = ++detailToken;
    showView('person');
    var panel = $('#person-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    window.scrollTo(0, 0);

    CS.tmdb.person(id).then(function (p) {
      if (token !== detailToken) return;
      personCtx = { p: p, shown: PAGE, token: token };
      remember(p.works);
      panel.innerHTML = CS.ui.person(p, personCtx.shown);
      hydrate(panel, p.works.slice(0, personCtx.shown));
      window.scrollTo(0, 0);
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🔴 ما قدرت أفتح صفحة الشخص</b><p>' +
        esc0(CS.tmdb.explain(err)) + '</p></div></div>';
    });
  }

  function morePersonWorks() {
    if (!personCtx) return;
    personCtx.shown += PAGE;
    var panel = $('#person-panel');
    panel.innerHTML = CS.ui.person(personCtx.p, personCtx.shown);
    hydrate(panel, personCtx.p.works.slice(0, personCtx.shown));
  }

  /* ============================================================
     الإعدادات
     ============================================================ */

  function openSettings() {
    $('#api-key').value    = CS.state.userKey || '';
    $('#omdb-key').value   = CS.store.get(CS.KEYS.omdbKey, '') || '';
    $('#fanart-key').value = CS.store.get(CS.KEYS.fanartKey, '') || '';
    $('#trakt-key').value  = CS.store.get(CS.KEYS.traktKey, '') || '';
    $('#tr-email').value   = CS.store.get(CS.KEYS.email, '') || '';
    $('#set-lang').value   = CS.state.lang;
    $('#set-region').value = CS.state.region;
    $('#set-autotr').checked = autoTranslateOn();

    var st = $('#key-state');
    st.className = 'keystate';
    st.textContent = '';
    $('#settings').hidden = false;
    document.body.classList.add('is-locked');
    setTimeout(function () { $('#set-lang').focus(); }, 60);
  }

  function closeSettings() {
    $('#settings').hidden = true;
    document.body.classList.remove('is-locked');
  }

  function rerenderCurrent() {
    var r = parseHash();
    if (r.name === 'detail') { openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { openWikiDetail(r.lang, r.title); return; }
    if (r.name === 'person') { openPerson(r.id); return; }
    if (CS.state.view === 'results' && CS.state.query) { doSearch(CS.state.query, true); return; }
    if (CS.state.view === 'liked') { renderLiked(); return; }
    startFeed(currentTab());
  }

  function finishSave() {
    setTimeout(function () { closeSettings(); CS.ui.toast('🟢 تم الحفظ'); rerenderCurrent(); }, 650);
  }

  function saveSettings() {
    var key = $('#api-key').value.trim();
    var state = $('#key-state');

    CS.state.lang = CS.store.set(CS.KEYS.lang, $('#set-lang').value);
    CS.state.region = CS.store.set(CS.KEYS.region, $('#set-region').value);
    CS.store.set(CS.KEYS.autoTr, $('#set-autotr').checked);
    $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';

    [['#omdb-key', CS.KEYS.omdbKey], ['#fanart-key', CS.KEYS.fanartKey],
     ['#trakt-key', CS.KEYS.traktKey], ['#tr-email', CS.KEYS.email]].forEach(function (pair) {
      var v = $(pair[0]).value.trim();
      if (v) CS.store.set(pair[1], v); else CS.store.remove(pair[1]);
    });

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
      state.textContent = '🔴 ' + CS.tmdb.explain(err);
    });
  }

  function refreshKeyNotice() {
    var off = CS.store.get(CS.KEYS.noticeOff, false);
    $('#key-notice').hidden = CS.hasKey() || off;
  }

  function showTmdbProblem(reason) {
    if (CS.store.get(CS.KEYS.noticeOff, false)) return;
    var bar = $('#key-notice');
    $('#key-notice-text').textContent = CS.state.userKey
      ? '🔴 مفتاحك الخاص ما يشتغل: ' + reason
      : '🔴 المفتاح المشترك ما يشتغل: ' + reason + ' — حط مفتاحك الخاص المجاني.';
    $('#notice-open-settings').textContent = 'افحص الاتصال';
    bar.dataset.tmdbBroken = '1';
    bar.hidden = false;
  }

  function testConnection() {
    var btn = $('#btn-test-key');
    var box = $('#key-state');
    var key = $('#api-key').value.trim();

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '⏳ يفحص…';
    box.className = 'keystate is-wait';
    box.textContent = 'أفحص الاتصال بـ TMDB…';

    CS.tmdb.diagnose(key || null).then(function (rep) {
      btn.disabled = false;
      btn.textContent = label;
      var rows = rep.steps.map(function (s) {
        return '<div class="diag__row"><span>' + (s.ok ? '🟢' : '🔴') + '</span><b>' +
          esc0(s.name) + '</b><i>' + esc0(s.detail) + '</i></div>';
      }).join('');
      box.className = 'keystate ' + (rep.ok ? 'is-ok' : 'is-bad');
      box.innerHTML = '<div class="diag__head">' +
        (rep.ok ? '🟢 كل شي شغّال — الموقع يقدر يبحث ويجيب البيانات' : '🔴 فيه خلل — تفاصيله تحت') +
        '</div>' + rows + (rep.ok ? '' : '<div class="diag__tip">' + esc0(hintFor(rep)) + '</div>');
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = label;
      box.className = 'keystate is-bad';
      box.textContent = '🔴 ما قدرت أكمّل الفحص: ' + (e && e.message || e);
    });
  }

  function hintFor(rep) {
    var d = (rep.steps.filter(function (s) { return !s.ok; })[0] || {}).detail || '';
    if (/401|رفض/.test(d)) return 'الحل: خذ مفتاحًا مجانيًا من themoviedb.org والصقه في الخانة فوق ثم احفظ.';
    if (/429|حد الطلبات/.test(d)) return 'الحل: انتظر دقيقة وأعد الفحص، أو استخدم مفتاحك الخاص.';
    if (/ما وصلت/.test(d)) return 'الحل: جرّب شبكة ثانية أو بيانات الجوال — بعض الشبكات تحجب api.themoviedb.org.';
    return 'جرّب مرة ثانية بعد شوي، وإذا تكرر أرسل لي نص الخطأ.';
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
      $('#suggest').innerHTML = list.map(function (it) {
        var img = it.poster
          ? '<img src="' + esc0(it.poster) + '" alt="" loading="lazy">'
          : '<span class="sug__ph">' + (it.type === 'tv' ? '📺' : '🎬') + '</span>';
        return '<button type="button" class="sug" data-open="' + esc0(CS.ui.itemKey(it)) + '">' + img +
          '<span class="sug__t"><b>' + esc0(it.title) + '</b><span>' +
          [it.year, CS.ui.TYPE_AR[it.type]].filter(Boolean).join(' · ') + '</span></span></button>';
      }).join('');
      $('#suggest').hidden = false;
    }).catch(hideSuggest);
  }, 320);

  /* ============================================================
     التوجيه
     ============================================================ */

  var suppressRoute = false;
  var ourSteps = 0;

  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  function parseHash() {
    var raw = location.hash.slice(1);
    if (!raw) return { name: 'home' };
    if (raw.charAt(0) !== '/') return { name: 'ignore' };

    var h = raw.replace(/^\//, '');
    if (!h) return { name: 'home' };
    var parts = h.split('/');

    if (parts[0] === 's' && parts.length >= 2) {
      return { name: 'search', query: decodeSafe(parts.slice(1).join('/')) };
    }
    if (parts[0] === 'person' && parts[1]) return { name: 'person', id: parts[1] };
    if (parts[0] === 'work') parts = parts.slice(1);

    if ((parts[0] === 'movie' || parts[0] === 'tv') && parts[1]) {
      return { name: 'detail', type: parts[0], id: parts[1] };
    }
    if (parts[0] === 'w' && parts.length >= 3) {
      return { name: 'wiki', lang: parts[1], title: decodeSafe(parts.slice(2).join('/')) };
    }
    if (parts[0] === 'liked' || parts[0] === 'fav') return { name: 'liked' };
    return { name: 'home' };
  }

  function onRoute() {
    if (suppressRoute) { suppressRoute = false; return; }
    var r = parseHash();
    if (r.name === 'ignore') return;

    if (r.name !== 'detail' && r.name !== 'wiki' && r.name !== 'person') detailToken++;

    if (r.name === 'detail') { CS.state.backTo = CS.state.backTo || '#/'; openDetail(r.type, r.id); return; }
    if (r.name === 'wiki')   { CS.state.backTo = CS.state.backTo || '#/'; openWikiDetail(r.lang, r.title); return; }
    if (r.name === 'person') { CS.state.backTo = CS.state.backTo || '#/'; openPerson(r.id); return; }

    CS.state.backTo = location.hash || '#/';

    if (r.name === 'search') { doSearch(r.query, true); return; }
    if (r.name === 'liked')  { renderLiked(); return; }

    showView('home');
    if (!CS.feed.current().items.length) startFeed(currentTab());
  }

  function goTo(hash) {
    var here = parseHash().name;
    if (here !== 'detail' && here !== 'wiki' && here !== 'person') CS.state.backTo = location.hash || '#/';
    if (location.hash !== hash) ourSteps++;
    location.hash = hash;
  }

  function goBack() {
    if (ourSteps > 0) { ourSteps--; history.back(); return; }
    location.hash = CS.state.backTo || '#/';
  }

  /* ============================================================
     التصويت
     ============================================================ */

  function handleVote(btn) {
    var item = itemCache[btn.dataset.item];
    if (!item) return;
    var now = CS.taste.set(item, +btn.dataset.vote);

    CS.ui.toast(now === 1 ? '👍 انضاف لذوقك' : now === -1 ? '👎 تمام، ما بكرّر لك شبيهه' : '⚪ شلت رأيك');

    $$('[data-item="' + attrEsc(btn.dataset.item) + '"]').forEach(function (b) {
      var on = +b.dataset.vote === now;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    updateLikeCount();
    if (CS.state.view === 'liked') renderLiked();
  }

  /* ============================================================
     التمرير اللانهائي
     ============================================================ */

  function watchSentinels() {
    if (!('IntersectionObserver' in window)) return;

    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        if (e.target.id === 'feed-sentinel' && CS.state.view === 'home' && !$('#feed-more').hidden) loadFeed(false);
        if (e.target.id === 'results-sentinel' && CS.state.view === 'results' && !$('#loadmore-wrap').hidden) {
          CS.state.shown += PAGE;
          paintResults();
        }
      });
    }, { rootMargin: '600px' }).observe($('#feed-sentinel')),

    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && CS.state.view === 'results' && !$('#loadmore-wrap').hidden) {
          CS.state.shown += PAGE;
          paintResults();
        }
      });
    }, { rootMargin: '600px' }).observe($('#results-sentinel'));
  }

  /* ============================================================
     ربط الأحداث
     ============================================================ */

  function bind() {

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#q').value.trim();
      if (q) goTo('#/s/' + encodeURIComponent(q));
    });

    $('#q').addEventListener('input', function () {
      var v = this.value.trim();
      $('#search-clear').hidden = !v;
      $('#btn-to-en').hidden = !CS.util.isArabic(v);
      suggestOff = false;
      runSuggest(v);
    });

    $('#q').addEventListener('focus', function () {
      suggestOff = false;
      if (this.value.trim().length >= 2) runSuggest(this.value.trim());
    });

    $('#search-clear').addEventListener('click', function () {
      $('#q').value = '';
      this.hidden = true;
      $('#btn-to-en').hidden = true;
      hideSuggest();
      $('#q').focus();
    });

    $('#btn-to-en').addEventListener('click', searchInEnglish);

    /* --- التبويبات وأدوات الخلاصة --- */
    $('#tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab');
      if (!t) return;
      setTab(t.dataset.tab);
      startFeed(t.dataset.tab);
    });

    ['#feed-sort', '#feed-lang', '#feed-rating'].forEach(function (sel) {
      $(sel).addEventListener('change', function () { startFeed(currentTab()); });
    });

    $('#btn-feed-more').addEventListener('click', function () { loadFeed(false); });
    $('#btn-loadmore').addEventListener('click', function () {
      CS.state.shown += PAGE;
      paintResults();
    });

    /* --- المفضلة --- */
    $('#btn-export').addEventListener('click', exportTaste);
    $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function () {
      importTaste(this.files && this.files[0]);
      this.value = '';
    });
    $('#btn-reset-taste').addEventListener('click', function () {
      if (!window.confirm('أصفّر كل الإعجابات وأرجع من الصفر؟')) return;
      CS.taste.clearAll();
      updateLikeCount();
      renderLiked();
      CS.ui.toast('⚪ انصفّر ذوقك');
    });

    /* --- تفويض النقر العام --- */
    document.addEventListener('click', function (e) {
      var vote = e.target.closest('[data-vote]');
      if (vote) { e.preventDefault(); handleVote(vote); return; }

      var person = e.target.closest('[data-person]');
      if (person) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        goTo('#/person/' + person.dataset.person);
        return;
      }

      var open = e.target.closest('[data-open]');
      if (open) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        suggestOff = true;
        hideSuggest();
        goTo('#/work/' + open.dataset.open);
        return;
      }

      var trBtn = e.target.closest('[data-translate-plot]');
      if (trBtn) { translatePlot(trBtn); return; }

      if (e.target.closest('[data-related-more]') && detailCtx) { loadRelated(detailCtx.d, detailCtx.token, false); return; }
      if (e.target.closest('[data-person-more]')) { morePersonWorks(); return; }

      var share = e.target.closest('[data-share]');
      if (share) { copyLink(location.origin + location.pathname + '#/work/' + share.dataset.share); return; }

      if (e.target.closest('[data-fatal-dismiss]')) { clearFatal(); return; }
      if (e.target.closest('[data-diagnose]')) { openSettings(); testConnection(); return; }
      if (e.target.closest('[data-retry-home]')) { startFeed(currentTab()); return; }
      if (e.target.closest('[data-tab-all]')) { setTab('all'); startFeed('all'); return; }
      if (e.target.closest('[data-back]')) { goBack(); return; }
      if (e.target.closest('[data-close-settings]')) { closeSettings(); return; }
      if (e.target.closest('[data-route-home]')) { e.preventDefault(); location.hash = '#/'; return; }

      if (!e.target.closest('#search-form')) hideSuggest();
    });

    /* --- أزرار الهيدر --- */
    $('#btn-fav').addEventListener('click', function () { goTo('#/liked'); });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#notice-open-settings').addEventListener('click', function () {
      openSettings();
      if ($('#key-notice').dataset.tmdbBroken) testConnection();
    });
    $('#notice-dismiss').addEventListener('click', function () {
      CS.store.set(CS.KEYS.noticeOff, true);
      $('#key-notice').hidden = true;
    });

    $('#btn-lang').addEventListener('click', function () {
      CS.state.lang = CS.store.set(CS.KEYS.lang, CS.state.lang === 'ar' ? 'en' : 'ar');
      $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';
      CS.ui.toast(CS.state.lang === 'ar' ? '🟢 لغة المحتوى: العربية' : '🟢 Content language: English');
      CS.tmdb.loadGenres().then(rerenderCurrent);
    });

    $('#btn-back-home').addEventListener('click', function () { location.hash = '#/'; });
    $('#btn-liked-back').addEventListener('click', function () { location.hash = '#/'; });

    /* --- الإعدادات --- */
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#btn-test-key').addEventListener('click', testConnection);
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
      if (e.key === 'Tab' && !$('#settings').hidden) {
        var panel = $('.modal__panel');
        var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])', panel)
          .filter(function (el) { return el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1], here = document.activeElement;
        if (e.shiftKey && (here === first || !panel.contains(here))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (here === last || !panel.contains(here))) { e.preventDefault(); first.focus(); }
        return;
      }

      if (e.key === 'Escape') {
        if (!$('#settings').hidden) return closeSettings();
        if (CS.state.view === 'detail' || CS.state.view === 'person') return goBack();
        hideSuggest();
        return;
      }
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    });

    window.addEventListener('hashchange', onRoute);
  }

  /* ============================================================
     حزام الأمان
     ============================================================ */

  var REQUIRED = ['util', 'store', 'state', 'taste', 'certs', 'tmdb', 'wiki', 'sources', 'links', 'feed', 'search', 'ui'];

  function fatal(title, detail, showReload) {
    var bar = document.getElementById('fatal');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fatal';
      bar.className = 'fatal';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.innerHTML = '<b>🔴 ' + esc0(title) + '</b><span>' + esc0(detail) + '</span>' +
      (showReload ? '<button class="notice__cta" id="fatal-reload">حدّث الصفحة الآن</button>' : '') +
      '<button class="notice__x" data-fatal-dismiss aria-label="إخفاء">&times;</button>';
    bar.hidden = false;
    var rl = document.getElementById('fatal-reload');
    if (rl) rl.addEventListener('click', hardReload);
  }

  function hardReload() {
    var url = location.href.split('#')[0].split('?')[0];
    location.replace(url + '?fresh=' + Date.now() + location.hash);
  }

  function clearFatal() {
    var bar = document.getElementById('fatal');
    if (bar) bar.hidden = true;
  }

  function step(fn) {
    try { fn(); } catch (e) { if (window.console) console.error('[ranhub] خطوة إقلاع فشلت:', e); }
  }

  function boot() {
    var missing = REQUIRED.filter(function (m) { return !CS[m]; });
    if (missing.length) {
      fatal('نسخة الصفحة قديمة',
            'متصفحك مخزّن نسخة قديمة من الموقع (' + missing.join('، ') + ' ناقصة). اضغط تحديث.', true);
      return;
    }

    try { bind(); }
    catch (e) { fatal('ما قدرت أربط الأزرار', String(e && e.message || e), true); return; }

    step(function () { $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN'; });
    step(function () {
      var moved = CS.taste.migrate();
      if (moved) setTimeout(function () { CS.ui.toast('👍 نقلت ' + moved + ' من مفضلتك القديمة'); }, 900);
    });
    step(updateLikeCount);
    step(refreshKeyNotice);
    step(watchSentinels);
    step(function () {
      /* نرجع لآخر قسم كان فيه، والفلتر يتبع القسم لا العكس */
      var tab = CS.store.get(CS.KEYS.tab, 'all');
      if (!TABS[tab]) tab = 'all';
      if (TABS[tab].cert !== 'all' && !CS.store.get(CS.KEYS.adultOn, false)) tab = 'all';
      setTab(tab);
      CS.store.set(CS.KEYS.certTier, TABS[tab].cert);
      $('#feed-title').textContent = TABS[tab].title;
      $('#age-warn').hidden = TABS[tab].cert === 'all';
    });

    var start = CS.hasKey() ? CS.tmdb.loadGenres().catch(function () {}) : Promise.resolve();
    /* onRoute تكفي: مسار الرئيسية يشغّل الخلاصة بنفسه.
       نداء ثانٍ هنا كان يصفّر الخلاصة وسط تحميلها فتطلع الشاشة فاضية. */
    start.then(function () {
      try { onRoute(); }
      catch (e) { fatal('ما قدرت أفتح الصفحة', String(e && e.message || e), true); }
    });
  }

  var reported = false;
  window.addEventListener('error', function (e) {
    if (reported || !e || !e.message) return;
    reported = true;
    try { fatal('صار خطأ في الصفحة', e.message, true); } catch (ignored) { /* آخر خط دفاع */ }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  CS.app = { fatal: fatal, clearFatal: clearFatal, hardReload: hardReload };

})(window.CS);
