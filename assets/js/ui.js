/* ============================================================
   ui.js — بناء الواجهة: البطاقات، صفحة العمل، صفحة الشخص
   ============================================================ */

(function (CS) {
  'use strict';

  var esc = CS.util.esc;
  var TYPE_AR = { movie: 'فيلم', tv: 'مسلسل' };
  var WHY_CLASS = { plot: 'is-plot', theme: 'is-theme', related: 'is-theme', title: '' };

  /* ---------- التوست ---------- */

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function skeletons(n) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="skel"><div class="skel__poster"></div><div class="skel__line"></div><div class="skel__line"></div></div>';
    }
    return out;
  }

  /* ---------- مفاتيح وعناصر ---------- */

  function itemKey(item) {
    if (item.source === 'wiki') {
      return 'w/' + (item.wikiLang || 'ar') + '/' + encodeURIComponent(item.wikiTitle || '');
    }
    return item.type + '/' + item.id;
  }

  function posterHtml(item) {
    if (item.poster) {
      return '<img src="' + esc(item.poster) + '" alt="بوستر ' + esc(item.title) + '" loading="lazy" decoding="async">';
    }
    return '<div class="card__ph"><b>' + (item.type === 'tv' ? '📺' : '🎬') + '</b><span>' + esc(item.title) + '</span></div>';
  }

  function scoreClass(r) { return r >= 7.5 ? 'is-high' : r > 0 && r < 5.5 ? 'is-low' : ''; }

  function certBadge(item) {
    var info = CS.certs.cachedFor(item);
    if (!info) return '';
    var t = CS.certs.tierInfo(info.tier);
    var text = info.tier === 5 ? '🔥 إباحي' : (t.emoji + ' ' + t.short);
    var title = info.tier === 5 ? 'معلَّم adult عند TMDB'
              : t.label + (info.cert ? ' · ' + info.cert + (info.country ? ' (' + info.country + ')' : '') : '');
    return '<span class="card__cert" style="border-color:' + esc(t.color) + '55;color:' + esc(t.color) +
           '" title="' + esc(title) + '">' + text + '</span>';
  }

  /* شريط الحسّية — مبني على وسوم TMDB الحقيقية، لا على نسبة مخترعة */
  function heatBar(item) {
    var h = item.heat;
    if (!h || !h.score) return '';
    return '<div class="card__heat" title="' + esc('وسوم TMDB: ' + h.tags.join('، ')) +
           '"><i style="width:' + h.score + '%"></i></div>';
  }

  /* نسبة التطابق مع بحث المستخدم — تظهر في النتائج فقط */
  function matchBadge(item) {
    if (!item.matchPct) return '';
    return '<span class="card__match' + (item.matchPct >= 85 ? ' is-top' : '') + '">مطابق ' +
      item.matchPct + '٪</span>';
  }

  function voteBar(item, big) {
    var v = CS.taste.verdict(item);
    var k = esc(itemKey(item));
    return '' +
      '<div class="vote' + (big ? ' vote--big' : '') + '">' +
        '<button class="vote__b vote__up' + (v === 1 ? ' is-on' : '') + '" data-vote="1" data-item="' + k + '" ' +
          'aria-pressed="' + (v === 1 ? 'true' : 'false') + '" aria-label="عجبني" title="عجبني">' +
          '<span aria-hidden="true">👍</span>' + (big ? '<b>عجبني</b>' : '') + '</button>' +
        '<button class="vote__b vote__down' + (v === -1 ? ' is-on' : '') + '" data-vote="-1" data-item="' + k + '" ' +
          'aria-pressed="' + (v === -1 ? 'true' : 'false') + '" aria-label="ما عجبني" title="ما عجبني">' +
          '<span aria-hidden="true">👎</span>' + (big ? '<b>ما عجبني</b>' : '') + '</button>' +
      '</div>';
  }

  /* ---------- البطاقة ---------- */

  function card(item) {
    var sub = [];
    if (item.year) sub.push(item.year);
    sub.push(TYPE_AR[item.type] || '');
    if (item.source === 'wiki') sub.push('ويكيبيديا');

    var plot = (item.overview || item.plotSnippet || '').trim();
    var why = item.whyText
      ? '<span class="card__why ' + (WHY_CLASS[item.why] || '') + '">' + esc(item.whyText) + '</span>' : '';
    var tags = (item.heat && item.heat.tags.length)
      ? '<div class="card__tags">' + item.heat.tags.slice(0, 3).map(function (t) {
          return '<span class="card__tag">' + esc(t) + '</span>';
        }).join('') + '</div>' : '';

    return '' +
      '<article class="card" data-key="' + esc(itemKey(item)) + '">' +
        '<a class="card__link" href="#/work/' + esc(itemKey(item)) + '" data-open="' + esc(itemKey(item)) + '">' +
          '<div class="card__poster">' + posterHtml(item) +
            (item.rating ? '<span class="card__score ' + scoreClass(item.rating) + '">' + item.rating.toFixed(1) + '</span>' : '') +
            '<span class="card__type">' + (TYPE_AR[item.type] || '') + '</span>' +
            matchBadge(item) + certBadge(item) + heatBar(item) +
          '</div>' +
          '<div class="card__body">' +
            '<h3 class="card__title">' + esc(item.title) + '</h3>' +
            '<p class="card__sub">' + esc(sub.filter(Boolean).join(' · ')) + '</p>' +
            (plot ? '<p class="card__plot">' + esc(plot) + '</p>' : '') +
            tags + why +
          '</div>' +
        '</a>' +
        voteBar(item, false) +
      '</article>';
  }

  function cards(list) { return list.map(card).join(''); }

  /* ---------- الروابط الخارجية ---------- */

  function linksHtml(item) {
    return '<h3 class="sec__title">ابحث عنه في كل المواقع</h3>' +
      '<div class="links">' + CS.links.build(item).map(function (l) {
        return '<a class="linkbtn" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="linkbtn__dot" style="background:' + esc(l.color) + '"></span>' +
          esc(l.label) + (l.exact ? '' : '<span class="linkbtn__x">بحث</span>') + '</a>';
      }).join('') + '</div>';
  }

  function providersHtml(p) {
    if (!p) return '';
    var groups = [['اشتراك', p.flatrate], ['إيجار', p.rent], ['شراء', p.buy]]
      .filter(function (g) { return g[1] && g[1].length; });
    if (!groups.length) return '';

    /* بيانات التوفّر من TMDB مصدرها JustWatch، وشروط TMDB تُلزم بنسبها
       لـJustWatch مع كل عمل لا مرة واحدة في التذييل — وإلا يُسحب الوصول */
    var credit = '<p class="prov__credit">مصدر بيانات التوفّر: ' +
      '<a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a>' +
      (p.link ? ' · <a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">كل المنصّات</a>' : '') +
      '</p>';

    return '<div class="prov">' + groups.map(function (g) {
      return '<div class="prov__g"><span class="prov__lbl">' + g[0] + '</span>' +
        g[1].map(function (x) {
          return '<img src="' + esc(x.logo) + '" alt="' + esc(x.name) + '" title="' + esc(x.name) + '" loading="lazy">';
        }).join('') + '</div>';
    }).join('') + credit + '</div>';
  }

  function metaRow(label, value) {
    if (!value) return '';
    return '<div><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  /* ---------- قسم القصة ---------- */

  function storySection(d, extra) {
    extra = extra || {};
    var short = extra.summary || '';
    var plot = extra.plotArabic || extra.fullPlot || '';

    var story = short;
    if (plot) {
      var head = CS.search.norm(short).slice(0, 60);
      if (!story) story = plot;
      else if (!head || CS.search.norm(plot).indexOf(head) === -1) story += '\n\n' + plot;
    }

    var html = story
      ? '<p class="overview">' + esc(story) + '</p>'
      : '<p class="overview overview--empty">ما لقيت ملخصًا لهالعمل — لا في TMDB ولا في ويكيبيديا. افتح روابط المواقع تحت.</p>';

    var plotIsArabic = extra.fullPlot ? CS.util.isArabic(extra.fullPlot) : false;
    var src = [];
    if (short) src.push(extra.summarySource || 'الملخص من TMDB');
    if (extra.plotArabic) src.push('القصة من ويكيبيديا (ترجمة آلية)');
    else if (extra.fullPlot) src.push('القصة من ويكيبيديا (' + (plotIsArabic ? 'عربي' : 'إنجليزي') + ')');
    if (extra.translating) src.push('⏳ يترجم…');
    if (src.length) html += '<p class="overview__src">🔸 ' + src.join(' · ') + '</p>';

    if (extra.fullPlot && !extra.plotArabic && !plotIsArabic && CS.state.lang === 'ar' && !extra.translating) {
      html += '<div class="dt__actions"><button class="btn btn--ghost btn--sm" data-translate-plot>' +
              '🔤 ترجم القصة الكاملة للعربية</button></div>';
    }
    if (extra.plotError) html += '<p class="overview__src">🔴 ' + esc(extra.plotError) + '</p>';

    return '<h3 class="sec__title">القصة الكاملة</h3>' + html;
  }

  /* ---------- المصادر الإضافية ---------- */

  function extraSources(d, ex) {
    ex = ex || {};
    var blocks = '';

    /* تقييمات OMDb انمسحت من هنا: صارت تتكرّر حرفيًا مع بطاقة OMDb
       في «بيانات إضافية» اللي يتحكّم فيها المشغّل بنفسه */

    if (ex.tvmaze) {
      var t = ex.tvmaze, r2 = '';
      r2 += metaRow('الحالة', t.status);
      r2 += metaRow('موعد العرض', t.schedule);
      if (t.next) r2 += metaRow('الحلقة القادمة', 'م' + t.next.season + ' ح' + t.next.number + (t.next.airdate ? ' · ' + t.next.airdate : ''));
      if (t.prev) r2 += metaRow('آخر حلقة', 'م' + t.prev.season + ' ح' + t.prev.number + (t.prev.airdate ? ' · ' + t.prev.airdate : ''));
      if (r2) blocks += '<h3 class="sec__title">مواعيد الحلقات <span class="sec__note">TVmaze</span></h3>' +
                        '<div class="metatable">' + r2 + '</div>';
    }

    return blocks;
  }

  /* ---------- صفحة العمل ---------- */

  function detailSkeleton() {
    return '<div class="dt__hero"><div class="dt__backdrop"></div>' +
      '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="dt__top"><div class="dt__poster skel__poster"></div>' +
      '<div class="dt__headings"><div class="skel__line" style="height:26px;width:60%"></div>' +
      '<div class="skel__line" style="width:35%"></div></div></div>' +
      '<div class="dt__body"><div class="skel__line"></div><div class="skel__line"></div></div>';
  }

  function detail(d, extra) {
    extra = extra || {};
    var facts = [];

    if (d.rating) facts.push('<span class="fact fact--score">★ ' + d.rating.toFixed(1) + (d.votes ? ' · ' + d.votes.toLocaleString('en-US') : '') + '</span>');
    if (d.year)   facts.push('<span class="fact">' + d.year + '</span>');
    facts.push('<span class="fact">' + (TYPE_AR[d.type] || '') + '</span>');
    if (d.runtime) facts.push('<span class="fact">' + esc(CS.util.minutes(d.runtime)) + '</span>');
    if (d.seasons) facts.push('<span class="fact">' + d.seasons + ' موسم · ' + d.episodes + ' حلقة</span>');

    var certInfo = CS.certs.cachedFor(d);
    if (certInfo) {
      var ct = CS.certs.tierInfo(certInfo.tier);
      facts.push('<span class="fact" style="border-color:' + esc(ct.color) + '66;color:' + esc(ct.color) + '">' +
        ct.emoji + ' ' + esc(ct.label) + (certInfo.cert && certInfo.tier !== 5 ? ' · ' + esc(certInfo.cert) : '') + '</span>');
    }
    (d.genres || []).forEach(function (g) { facts.push('<span class="fact">' + esc(g) + '</span>'); });
    if (d.directors && d.directors.length) facts.push('<span class="fact">🎬 ' + esc(d.directors.join('، ')) + '</span>');
    if (d.countries && d.countries.length) facts.push('<span class="fact">' + esc(d.countries.slice(0, 2).join('، ')) + '</span>');

    /* وسوم المحتوى الحسّي — من كلمات TMDB الحقيقية */
    var heatHtml = '';
    if (d.heat && d.heat.tags.length) {
      heatHtml = '<section><h3 class="sec__title">وسوم المحتوى ' +
        '<span class="sec__note">اضغط الوسم يعرض لك كل الأعمال اللي تحمله</span></h3>' +
        '<div class="tags">' + d.heat.tags.map(function (t) {
          /* الوسم مصطلح TMDB الإنجليزي نفسه، فالضغط يبحث عنه ككلمة مفتاحية حقيقية */
          return '<a class="tag tag--heat" href="#/tag/' + esc(encodeURIComponent(t)) +
            '" data-tag="' + esc(t) + '">#' + esc(String(t).replace(/\s+/g, '-')) + '</a>';
        }).join('') + '</div></section>';
    }

    var castHtml = (d.cast && d.cast.length)
      ? '<div class="cast">' + d.cast.map(function (c) {
          return '<a class="cast__p" href="#/person/' + esc(c.id) + '" data-person="' + esc(c.id) + '">' +
            (c.photo ? '<img src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" loading="lazy">' : '<div class="cast__ph">👤</div>') +
            '<b>' + esc(c.name) + '</b>' + (c.role ? '<span>' + esc(c.role) + '</span>' : '') + '</a>';
        }).join('') + '</div>' : '';


    var provHtml = providersHtml(d.providers);

    /* أزرار المشاهدة السريعة فوق */
    var watchName = d.originalTitle || d.title;
    var watchBtns =
      '<a class="linkbtn linkbtn--hero" target="_blank" rel="noopener noreferrer" ' +
        'href="https://web.stremio.com/#/search?search=' + encodeURIComponent(watchName) + '">' +
        '<span class="linkbtn__dot" style="background:#7b5bf5"></span>Stremio</a>' +
      '<a class="linkbtn linkbtn--hero" target="_blank" rel="noopener noreferrer" ' +
        'href="https://yandex.com/search/?text=' + encodeURIComponent(watchName + ' ' + (d.year || '') + ' online') + '">' +
        '<span class="linkbtn__dot" style="background:#fc3f1d"></span>Yandex</a>';

    return '' +
      '<div class="dt__hero">' +
        '<div class="dt__backdrop">' + (d.backdrop ? '<img src="' + esc(d.backdrop) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button>' +
      '</div>' +

      '<div class="dt__top">' +
        '<div class="dt__poster">' + posterHtml(d) + '</div>' +
        '<div class="dt__headings">' +
          '<h2 class="dt__title">' + esc(d.title) + '</h2>' +
          (d.originalTitle ? '<p class="dt__original">' + esc(d.originalTitle) + '</p>' : '') +
          (d.tagline ? '<p class="dt__tagline">«' + esc(d.tagline) + '»</p>' : '') +
          '<div class="dt__facts">' + facts.join('') + '</div>' +
          '<div class="dt__actions">' + voteBar(d, true) +
            '<button class="btn btn--ghost" data-share="' + esc(itemKey(d)) + '">🔗 انسخ الرابط</button>' +
          '</div>' +
          '<div class="dt__actions">' + watchBtns + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dt__body">' +
        '<section id="dt-story">' + storySection(d, extra) + '</section>' +
        heatHtml +
        (provHtml ? '<section><h3 class="sec__title">وين تشوفه <span class="sec__note">(' + esc(CS.state.region) + ')</span></h3>' + provHtml + '</section>' : '') +
        '<section id="dt-datasources"></section>' +
        '<section id="dt-links">' + linksHtml(d) + '</section>' +
        (castHtml ? '<section><h3 class="sec__title">طاقم العمل <span class="sec__note">اضغط أي اسم لأعماله</span></h3>' + castHtml + '</section>' : '') +
        '<section id="dt-extra"></section>' +
        '<section id="dt-related"></section>' +
      '</div>';
  }

  /* قسم الأعمال ذات الصلة مع «اعرض المزيد» */
  function relatedSection(items, exhausted, loading) {
    if (!items.length) return '';
    return '<h3 class="sec__title">أعمال ذات صلة <span class="sec__note">' + items.length + ' عمل</span></h3>' +
      '<div class="grid">' + cards(items) + '</div>' +
      (exhausted ? '' :
        '<div class="loadmore"><button class="btn btn--ghost" data-related-more ' +
        (loading ? 'disabled' : '') + '>' + (loading ? '⏳ يحمّل…' : 'اعرض المزيد') + '</button></div>');
  }

  /* ---------- صفحة الشخص ---------- */

  function person(p, shown) {
    var meta = [p.job, p.birthday ? 'مواليد ' + p.birthday : '', p.place].filter(Boolean).join(' · ');
    var list = p.works.slice(0, shown);

    return '' +
      '<div class="dt__hero"><div class="dt__backdrop"></div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="person__head">' +
        (p.photo ? '<img class="person__photo" src="' + esc(p.photo) + '" alt="' + esc(p.name) + '">'
                 : '<div class="person__photo cast__ph">👤</div>') +
        '<div><h2 class="person__name">' + esc(p.name) + '</h2>' +
        (meta ? '<p class="person__meta">' + esc(meta) + '</p>' : '') +
        '<p class="person__meta">' + p.works.length + ' عمل</p></div>' +
      '</div>' +
      '<div class="dt__body">' +
        (p.bio ? '<section><h3 class="sec__title">نبذة</h3><p class="overview">' + esc(p.bio) + '</p></section>' : '') +
        '<section><h3 class="sec__title">أعماله</h3>' +
          '<div class="grid">' + cards(list) + '</div>' +
          (shown < p.works.length
            ? '<div class="loadmore"><button class="btn" data-person-more>اعرض المزيد</button>' +
              '<p class="loadmore__note">' + shown + ' من ' + p.works.length + '</p></div>' : '') +
        '</section>' +
      '</div>';
  }

  /* ---------- حالات فارغة ---------- */

  function emptyHtml(query, meta) {
    meta = meta || {};
    if (meta.tmdbError) {
      return '<b>🔴 TMDB ما رد</b><p>' + esc(meta.tmdbError) + '</p>' +
        '<div style="margin-top:1.2rem"><button class="btn" data-diagnose>🔍 افحص الاتصال</button></div>' +
        '<p style="margin-top:1rem;font-size:.82rem">🟢 البحث بوصف القصة عبر ويكيبيديا يضل شغّالًا.</p>';
    }
    var tips = [
      'اكتب المشهد اللي تذكره بالتفصيل: «رجل يجلس على كرسي متحرك ويراقب جيرانه».',
      'جرّب زر «ترجم EN» جنب البحث — تغطية ويكيبيديا الإنجليزية أوسع بكثير.',
      'اذكر أسماء الممثلين أو المخرج لو تذكرها.'
    ];
    if (meta.certFiltered) tips.unshift('قسم «' + esc(meta.certFiltered) + '» شغّال — رجّع لقسم «الكل».');
    return '<b>🔴 ما لقيت شي لـ «' + esc(query) + '»</b><p>جرّب كذا:</p><ul><li>' + tips.join('</li><li>') + '</li></ul>';
  }

  /* قسم المشاهدة من مصادر المشغّل */
  /* بيانات إضافية جاءت من مصادر البيانات اللي أضافها المشغّل */
  function dataSection(blocks) {
    if (!blocks || !blocks.length) return '';

    /* مصدر ما ينطبق على نوع العمل أصلًا ما يستاهل بطاقة كاملة — سطر واحد يكفي */
    var skipped = blocks.filter(function (b) { return !b.loading && !b.ok && /^يحتاج /.test(b.detail || ''); });
    var shown   = blocks.filter(function (b) { return skipped.indexOf(b) === -1; });
    if (!shown.length && !skipped.length) return '';

    var cards = shown.map(function (b) {
      var body;
      if (b.loading) body = '<i class="ds__wait">⏳ يجيب…</i>';
      else if (!b.ok) body = '<i class="ds__bad">🔴 ' + esc(b.detail || 'ما رجّع بيانات') + '</i>';
      else if (!b.rows.length) body = '<i class="ds__bad">🟡 ما فيه بيانات لهذا العمل</i>';
      else body = '<dl class="ds__rows">' + b.rows.map(function (r) {
        var v = String(r[1]);
        var val = /^https?:\/\//.test(v)
          ? '<a href="' + esc(v) + '" target="_blank" rel="noopener noreferrer">' + esc(v) + '</a>'
          : esc(v);
        return '<dt>' + esc(r[0]) + '</dt><dd>' + val + '</dd>';
      }).join('') + '</dl>';

      return '<div class="ds"><b class="ds__name">' + esc(b.name) + '</b>' + body + '</div>';
    }).join('');

    var note = skipped.length
      ? '<p class="ds__skip">⚪ ما ناديت ' +
        skipped.map(function (b) { return esc(b.name) + ' (' + esc(b.detail) + ')'; }).join('، ') + '.</p>'
      : '';

    return '<h3 class="sec__title">بيانات إضافية <span class="sec__note">من مصادرك</span></h3>' +
      (cards ? '<div class="dslist">' + cards + '</div>' : '') + note;
  }

  CS.ui = {
    dataSection: dataSection,
    toast: toast,
    skeletons: skeletons,
    card: card,
    cards: cards,
    detail: detail,
    detailSkeleton: detailSkeleton,
    storySection: storySection,
    relatedSection: relatedSection,
    extraSources: extraSources,
    person: person,
    emptyHtml: emptyHtml,
    itemKey: itemKey,
    linksHtml: linksHtml,
    voteBar: voteBar,
    certBadge: certBadge,
    TYPE_AR: TYPE_AR
  };

})(window.CS);
