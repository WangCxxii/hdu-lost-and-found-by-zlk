/* ============================================================
   杭电失物招领系统
   纯前端交互原型：本地存储 + 哈希路由 + 完整发布/认领/归还闭环
   ============================================================ */
(function () {
  'use strict';

  const D = window.HDUData;
  const API = window.HDUApi;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');
  const announcer = document.getElementById('announcer');

  const GUEST = {
    id: null,
    name: '同学',
    studentId: '',
    college: '',
    grade: '',
    verified: false,
    trustScore: 0,
    initial: '访',
    tone: 'blue',
    bio: '',
    phone: '',
    wechat: ''
  };

  let db = D.load();
  let apiMode = false;
  let apiReady = false;

  const state = {
    route: { name: 'home' },
    stack: [],
    scrollPositions: {},
    loggedIn: true,
    apiMode: false,
    homeScrollTop: 0,
    lastViewedId: null,
    feed: {
      type: 'all',
      category: 'all',
      visible: 6
    },
    filters: {
      location: 'all',
      time: 'all',
      status: 'all',
      sort: 'newest'
    },
    filterDraft: null,
    search: { query: '', scope: 'all' },
    sheet: null,
    dialog: null,
    form: null,
    success: null,
    matches: {},
    revealed: new Set(),
    loginError: '',
    loginId: '23034112',
    loginPass: '',
    feedbackCategory: '功能建议',
    reportReason: '虚假信息',
    locationQuery: '',
    notificationsFilter: 'all'
  };

  /* ============================== 基础工具 ============================== */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function icon(name, cls) {
    return `<svg class="icon ${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function nowTime() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function statusbar(tone) {
    const cls = tone ? `statusbar--${tone}` : '';
    return `<div class="statusbar ${cls}">
      <span class="js-time">${nowTime()}</span>
      <div class="status-icons" aria-hidden="true">
        ${icon('signal')}${icon('wifi')}${icon('battery')}
      </div>
    </div>`;
  }

  function toast(message, tone) {
    if (!toastRoot) return;
    const el = document.createElement('div');
    el.className = 'toast' + (tone === 'warn' ? ' toast--warn' : '');
    el.innerHTML = `${icon(tone === 'warn' ? 'alert' : 'check-circle')}<span>${esc(message)}</span>`;
    toastRoot.appendChild(el);
    while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    }, 2400);
  }

  function announce(message) {
    if (announcer) announcer.textContent = message;
  }

  function saveOrWarn() {
    if (!D.save(db)) {
      toast('本地存储空间不足，本次修改可能无法保留', 'warn');
    }
  }

  function applyBootstrap(data) {
    const current = data.user;
    const users = Array.isArray(data.users) ? data.users.slice() : [];
    if (current) {
      const existing = users.find((u) => u.id === current.id);
      if (existing) Object.assign(existing, current);
      else users.push(current);
    }
    db.users = users;
    db.currentUserId = current ? current.id : null;
    db.items = Array.isArray(data.items) ? data.items : [];
    db.claims = Array.isArray(data.claims) ? data.claims : [];
    db.notifications = Array.isArray(data.notifications) ? data.notifications : [];
    db.favorites = (db.favorites || []).filter((id) => db.items.some((i) => i.id === id));
    state.loggedIn = !!current;
    state.apiMode = true;
    apiMode = true;
    apiReady = true;
  }

  async function syncFromApi(showError) {
    if (!API || !apiMode) return false;
    try {
      apiReady = false;
      const data = await API.bootstrap();
      applyBootstrap(data);
      apiReady = true;
      return true;
    } catch (error) {
      apiReady = true;
      if (showError) toast(error.message || '服务器连接失败', 'warn');
      return false;
    }
  }

  function apiError(error) {
    if (error && error.status === 401) {
      state.loggedIn = false;
      db.currentUserId = null;
      navigate('login', {}, true);
      toast('登录已失效，请重新登录', 'warn');
      return;
    }
    toast((error && error.message) || '操作失败，请稍后重试', 'warn');
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function relativeTime(iso) {
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return '';
    const diff = Date.now() - d;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.max(1, Math.floor(diff / 60000)) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 2 * 24 * 60 * 60 * 1000) return '昨天';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    const date = new Date(d);
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  function fullDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function dateLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  function dateInputValue(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function timeInputValue(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function displayName(name) {
    const value = String(name || '').trim() || '同学';
    return value.endsWith('同学') ? value : value + '同学';
  }

  function maskPhone(phone) {
    const p = String(phone || '');
    if (p.length < 7) return p;
    return p.slice(0, 3) + '****' + p.slice(-4);
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/[^\d]/g, '');
  }

  function me() {
    if (!db.currentUserId) return GUEST;
    return db.users.find((u) => u.id === db.currentUserId) || GUEST;
  }

  function userById(id) {
    return db.users.find((u) => u.id === id) || GUEST;
  }

  function itemById(id) {
    return db.items.find((i) => i.id === id);
  }

  function categoryById(id) {
    return D.CATEGORIES.find((c) => c.id === id) || D.CATEGORIES[D.CATEGORIES.length - 1];
  }

  function claimsForItem(id) {
    return db.claims.filter((c) => c.itemId === id);
  }

  function claimByMe(id) {
    return db.claims.find((c) => c.itemId === id && c.claimantId === db.currentUserId && c.status !== 'rejected');
  }

  function unreadCount() {
    return db.notifications.filter((n) => !n.read).length;
  }

  function isFavorite(id) {
    return db.favorites.includes(id);
  }

  function typeLabel(type) {
    return type === 'lost' ? '寻物' : '招领';
  }

  function typeName(type) {
    return type === 'lost' ? '我丢了东西' : '我捡到东西';
  }

  function statusInfo(item) {
    if (item.status === 'returned') return { text: '已归还', cls: 'returned', dot: 'returned' };
    if (item.status === 'offline') return { text: '已下架', cls: 'offline', dot: 'returned' };
    if (item.status === 'claimed') return { text: '待交接', cls: 'claimed', dot: 'claimed' };
    if (item.type === 'lost') return { text: '寻找中', cls: 'active', dot: 'active' };
    return { text: '待认领', cls: 'active', dot: 'active' };
  }

  function claimStatusInfo(status) {
    switch (status) {
      case 'approved':
        return { text: '已通过', cls: 'approved', hint: '请联系对方完成交接' };
      case 'returned':
        return { text: '已归还', cls: 'returned', hint: '物品已完成归还' };
      case 'rejected':
        return { text: '未通过', cls: 'rejected', hint: '发布者未通过本次认领' };
      default:
        return { text: '审核中', cls: 'pending', hint: '等待发布者核对特征' };
    }
  }

  function claimAnswerHTML(claim) {
    if (Array.isArray(claim.answers) && claim.answers.length) {
      return `<div class="claim-answers">${claim.answers
        .map(
          (a) => `<div class="answer-line"><span class="answer-q">${esc(a.q)}</span><strong>${esc(a.a || '未填写')}</strong>${a.match ? '<i class="answer-match">匹配</i>' : '<i class="answer-mismatch">不匹配</i>'}</div>`
        )
        .join('')}</div>`;
    }
    return `<div class="claim-answer"><strong>核验描述：</strong>${esc(claim.answer || claim.message || '未填写')}</div>`;
  }

  function trustPill(user) {
    const score = Number(user && user.trustScore) || 0;
    const cls = score >= 90 ? 'high' : score >= 80 ? 'mid' : 'low';
    return `<span class="trust-pill trust-pill--${cls}">信用 ${score}</span>`;
  }

  function handoverHTML(claim, received) {
    if (claim.status === 'returned') {
      return `<div class="handover-done">${icon('check-circle')} 交接完成 · 已归档</div>`;
    }
    if (claim.status === 'approved') {
      if (received) {
        return `<div class="handover-box">${icon('key')}<div><span>交接码</span><strong>${esc(claim.handoverCode || '******')}</strong><small>当面告知认领人，由对方输入确认；不要提前发给陌生人。</small></div></div>
          <div class="handover-state">${claim.claimantConfirmed ? `${icon('check')} 认领人已确认收货` : `${icon('clock')} 等待认领人输入交接码`}</div>
          ${claim.canOwnerConfirm || claim.claimantConfirmed ? `<button class="btn btn--primary btn--sm btn--block" data-action="owner-confirm" data-id="${esc(claim.id)}">${icon('check-circle')}确认完成交接</button>` : ''}`;
      }
      if (claim.canConfirm) {
        return `<div class="handover-box"><div><span>输入交接码</span><div class="handover-input"><input id="handoverCode" inputmode="numeric" maxlength="6" placeholder="6 位数字"><button class="btn btn--primary btn--sm" data-action="claimant-confirm" data-id="${esc(claim.id)}">确认收货</button></div><small>向发布者当面索取交接码，输入后等待对方确认。</small></div></div>`;
      }
      return `<div class="handover-state">${claim.claimantConfirmed ? `${icon('clock')} 已确认收货，等待发布者确认` : `${icon('clock')} 等待发布者提供交接码`}</div>`;
    }
    return '';
  }

  function avatar(user, cls) {
    if (!user) user = me();
    return `<span class="avatar avatar--${esc(user.tone || 'blue')} ${cls || ''}">${esc(user.initial || user.name.slice(0, 1))}</span>`;
  }

  function verifiedBadge(user) {
    if (!user || !user.verified) return '';
    return `<span class="verified-badge">${icon('verified')}已认证</span>`;
  }

  function highlight(text, query) {
    const safe = esc(text);
    if (!query) return safe;
    const q = query.trim();
    if (!q) return safe;
    try {
      return safe.replace(new RegExp('(' + escapeRegExp(q) + ')', 'gi'), '<mark class="search-highlight">$1</mark>');
    } catch (e) {
      return safe;
    }
  }

  /* ============================== 路由 ============================== */

  function parseHash() {
    const hash = location.hash.replace(/^#\/?/, '');
    if (!hash) return { name: 'home' };
    const parts = hash.split('?');
    const segments = parts[0].split('/').filter(Boolean);
    const params = {};
    if (parts[1]) {
      parts[1].split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k) params[k] = decodeURIComponent(v || '');
      });
    }
    const name = segments[0] || 'home';
    if (name === 'item' && segments[1]) return { name: 'detail', id: segments[1] };
    if (name === 'publish') return { name: 'publish', type: params.type || 'lost', id: params.id || null };
    if (name === 'me') {
      const map = {
        posts: 'my-posts',
        claims: 'my-claims',
        favorites: 'favorites',
        notifications: 'notifications',
        settings: 'settings',
        security: 'security'
      };
      return { name: segments[1] ? map[segments[1]] || 'profile' : 'profile' };
    }
    return { name, ...params };
  }

  function routeHash(route) {
    switch (route.name) {
      case 'home':
        return '#/home';
      case 'detail':
        return `#/item/${encodeURIComponent(route.id)}`;
      case 'publish':
        return `#/publish?type=${encodeURIComponent(route.type || 'lost')}${route.id ? '&id=' + encodeURIComponent(route.id) : ''}`;
      case 'profile':
        return '#/me';
      case 'my-posts':
        return '#/me/posts';
      case 'my-claims':
        return '#/me/claims';
      case 'favorites':
        return '#/me/favorites';
      case 'notifications':
        return '#/me/notifications';
      case 'settings':
        return '#/me/settings';
      case 'security':
        return '#/me/security';
      case 'feedback':
        return '#/feedback';
      case 'login':
        return '#/login';
      case 'about':
        return '#/about';
      default:
        return '#/home';
    }
  }

  function activeScroller() {
    return app.querySelector('.view-scroll, .home-scroll, .profile-scroll, .detail-scroll, .form-scroll');
  }

  function scrollKey(route) {
    const r = route || state.route;
    const parts = [r.name || 'home', r.id || ''];
    if (r.name === 'home') {
      parts.push(state.feed.type, state.feed.category);
      parts.push(state.filters.location, state.filters.time, state.filters.status, state.filters.sort);
    } else if (r.name === 'search') {
      parts.push(state.search.query);
    } else if (r.name === 'my-posts') {
      parts.push(state.postsTab || 'all');
    } else if (r.name === 'my-claims') {
      parts.push(state.claimsTab || 'mine');
    }
    return parts.join('|');
  }

  function rememberScroll() {
    const scroller = activeScroller();
    if (!scroller) return;
    state.scrollPositions[scrollKey()] = scroller.scrollTop;
    const keys = Object.keys(state.scrollPositions);
    if (keys.length > 40) delete state.scrollPositions[keys[0]];
  }

  function forgetScroll(route) {
    delete state.scrollPositions[scrollKey(route)];
  }

  function navigate(name, params, replace) {
    const route = Object.assign({ name }, params || {});
    if (name === 'publish') preparePublish(route);
    if (!state.loggedIn && ['profile', 'my-posts', 'my-claims', 'favorites', 'notifications', 'settings', 'security', 'feedback', 'publish'].includes(name)) {
      name = 'login';
      route.name = 'login';
    }
    rememberScroll();
    const current = state.route;
    if (!replace && current && current.name && !(current.name === route.name && current.id === route.id)) {
      state.stack.push(Object.assign({}, current));
      if (state.stack.length > 30) state.stack.shift();
    }
    if (replace) {
      history.replaceState(route, '', routeHash(route));
    } else {
      history.pushState(route, '', routeHash(route));
    }
    state.route = route;
    closeSheet(true);
    closeDialog(true);
    removeSuccess();
    render();
    announce('已进入' + pageTitle(route));
  }

  function goBack(fallback) {
    rememberScroll();
    const prev = state.stack.pop();
    if (prev) {
      if (prev.name === 'publish') preparePublish(prev);
      history.replaceState(prev, '', routeHash(prev));
      state.route = prev;
      closeSheet(true);
      closeDialog(true);
      render();
      return;
    }
    navigate(fallback || 'home', {}, true);
  }

  function pageTitle(route) {
    const map = {
      home: '首页',
      search: '搜索',
      detail: '物品详情',
      publish: '发布',
      profile: '个人中心',
      'my-posts': '我的发布',
      'my-claims': '我的认领',
      favorites: '我的收藏',
      notifications: '消息通知',
      settings: '设置',
      security: '账户安全',
      feedback: '反馈与建议',
      login: '校园身份认证',
      about: '关于我们'
    };
    return map[route.name] || '杭电失物招领系统';
  }

  window.addEventListener('popstate', () => {
    rememberScroll();
    const route = parseHash();
    if (route.name === 'publish') preparePublish(route);
    state.route = route;
    state.stack = [];
    closeSheet(true);
    closeDialog(true);
    removeSuccess();
    render();
  });

  /* ============================== 数据查询 ============================== */

  function baseItems() {
    return db.items.filter((i) => i.status !== 'offline');
  }

  function matchesLocation(location, filter) {
    const text = String(location || '');
    if (!filter || filter === 'all') return true;
    if (filter === '图书馆') return text.includes('图书馆');
    if (filter === '教学区') return /[一二三四五六七]教/.test(text);
    if (filter === '食堂') return text.includes('食堂');
    if (filter === '宿舍') return text.includes('宿舍');
    if (filter === '运动场') return /体育馆|田径场|篮球场|游泳馆/.test(text);
    if (filter === '其他') {
      return !/图书馆|[一二三四五六七]教|食堂|宿舍|体育馆|田径场|篮球场|游泳馆/.test(text);
    }
    return text.includes(filter);
  }

  function isToday(iso) {
    const d = new Date(iso);
    const n = new Date();
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  }

  function filteredFeed() {
    let list = baseItems();
    if (state.feed.type !== 'all') list = list.filter((i) => i.type === state.feed.type);
    if (state.feed.category !== 'all') list = list.filter((i) => i.category === state.feed.category);
    if (state.filters.location !== 'all') list = list.filter((i) => matchesLocation(i.location, state.filters.location));
    if (state.filters.status === 'active') list = list.filter((i) => i.status === 'active' || i.status === 'claimed');
    if (state.filters.status === 'returned') list = list.filter((i) => i.status === 'returned');
    if (state.filters.time !== 'all') {
      if (state.filters.time === 'today') list = list.filter((i) => isToday(i.createdAt));
      else {
        const days = { 3: 3, 7: 7, 30: 30 }[state.filters.time] || 0;
        if (days) {
          const cutoff = Date.now() - days * 86400000;
          list = list.filter((i) => new Date(i.createdAt).getTime() >= cutoff);
        }
      }
    }
    return sortItems(list, state.filters.sort);
  }

  function sortItems(list, sort) {
    const copy = list.slice();
    if (sort === 'oldest') copy.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sort === 'views') copy.sort((a, b) => b.views - a.views);
    else copy.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return copy;
  }

  function searchItems(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sortItems(
      baseItems().filter((item) => {
        const cat = categoryById(item.category).name;
        return [item.title, item.description, item.location, cat, typeLabel(item.type)]
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
      'newest'
    );
  }

  function feedCounts() {
    const list = baseItems();
    return {
      all: list.length,
      lost: list.filter((i) => i.type === 'lost').length,
      found: list.filter((i) => i.type === 'found').length
    };
  }

  /* ============================== 通用组件 ============================== */

  function itemCard(item, compact) {
    const cat = categoryById(item.category);
    const st = statusInfo(item);
    const owner = userById(item.ownerId);
    const isMine = item.ownerId === db.currentUserId;
    return `<a class="item-card ${compact ? 'item-card--compact' : ''}" href="${routeHash({ name: 'detail', id: item.id })}" data-action="open-item" data-id="${esc(item.id)}" aria-label="${esc(item.title)}，${esc(st.text)}">
      <div class="item-thumb">
        <img src="${esc(item.images[0] || D.ITEM_IMAGES.fallback)}" alt="${esc(cat.name)}" loading="lazy" onerror="this.src='${D.ITEM_IMAGES.fallback}'">
        <span class="item-type item-type--${item.type}">${typeLabel(item.type)}</span>
      </div>
      <div class="item-main">
        <div class="item-top">
          ${item.urgent ? '<span class="badge badge--urgent">急寻</span>' : ''}
          <span class="item-status ${st.dot === 'returned' ? 'item-status--returned' : ''}"><i></i>${st.text}</span>
        </div>
        <h3>${esc(item.title)}</h3>
        <p class="item-meta">${icon('location')}<span>${esc(item.location)}</span><i class="meta-sep"></i>${icon('clock')}<span>${relativeTime(item.createdAt)}</span></p>
        <div class="item-foot">
          <span class="cat">${esc(cat.name)}</span>
          <span class="views">${icon('eye')}${item.views}</span>
          ${isMine ? `<span class="foot-owner">${icon('user')}我发布的</span>` : `<span class="foot-owner">${icon('user')}${esc(owner.name)}</span>`}
        </div>
      </div>
    </a>`;
  }

  function emptyState(opts) {
    return `<div class="empty">
      <img src="${opts.image || 'assets/empty-box.svg'}" alt="">
      <h3>${esc(opts.title)}</h3>
      <p>${esc(opts.text)}</p>
      ${opts.actionLabel ? `<button class="btn btn--primary btn--sm" data-action="${opts.action || 'open-publish'}" data-type="${opts.type || 'lost'}">${icon(opts.actionIcon || 'plus')}${esc(opts.actionLabel)}</button>` : ''}
    </div>`;
  }

  function tabbar(active) {
    return `<nav class="tabbar" aria-label="底部导航">
      <button class="tab ${active === 'home' ? 'is-active' : ''}" data-nav="home" aria-label="首页">
        ${icon('home')}<span>首页</span>
      </button>
      <button class="tab tab--publish" data-action="open-publish" data-type="lost" aria-label="发布">
        <span class="tab-publish">${icon('plus')}</span><span>发布</span>
      </button>
      <button class="tab ${active === 'profile' ? 'is-active' : ''}" data-nav="profile" aria-label="个人中心">
        ${icon('user')}<span>个人中心</span>
      </button>
    </nav>`;
  }

  function topbar(title, opts) {
    const o = opts || {};
    return `<header class="topbar">
      <button class="icon-btn" data-action="back" aria-label="返回">${icon('chevron-left')}</button>
      <h1>${esc(title)}</h1>
      <div class="topbar-side">${o.right || ''}</div>
    </header>`;
  }

  /* ============================== 首页 ============================== */

  function renderHome() {
    const counts = feedCounts();
    const list = filteredFeed();
    const shown = list.slice(0, state.feed.visible);
    const unread = unreadCount();
    const activeCount = db.items.filter((i) => i.status === 'active' || i.status === 'claimed').length;
    const returnedCount = db.items.filter((i) => i.status === 'returned').length;
    const todayCount = db.items.filter((i) => {
      const t = new Date(i.createdAt);
      const n = new Date();
      return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
    }).length;
    const filtersActive =
      state.filters.location !== 'all' ||
      state.filters.time !== 'all' ||
      state.filters.status !== 'all' ||
      state.filters.sort !== 'newest';

    return `<div class="view view--home">
      ${statusbar('dark')}
      <div class="home-scroll" id="homeScroll">
        <section class="home-hero">
          <header class="home-top">
            <div class="home-brand">
              <span class="home-brand-logo"><img src="assets/hdu-logo.jpg" alt="杭州电子科技大学"></span>
              <span class="home-brand-text"><strong>杭电失物招领系统</strong><small>LOST &amp; FOUND</small></span>
            </div>
            <div class="home-tools">
              <button class="home-tool" data-nav="notifications" aria-label="消息通知">
                ${icon('bell')}${unread ? '<i class="home-tool-dot"></i>' : ''}
              </button>
              <button class="home-tool home-tool--avatar" data-nav="profile" aria-label="个人中心">${esc(me().initial)}</button>
            </div>
          </header>
          <div class="home-copy">
            <p class="hero-kicker"><i class="pulse"></i>${greeting()}，${state.loggedIn ? esc(displayName(me().name)) : '同学'}<span class="k-sep">/</span>${dateLabel(new Date().toISOString())}</p>
            <h1 class="home-title">今天，<br><span>有东西在等你。</span></h1>
          </div>
          <button class="search-trigger" data-nav="search" aria-label="搜索失物招领">
            ${icon('search')}
            <span>搜索物品、地点或关键词</span>
            <span class="search-filter-btn" data-action="open-filter" aria-label="筛选">${icon('sliders')}</span>
          </button>
          <div class="hero-stats">
            <div><strong>${activeCount}</strong><span>在架</span></div>
            <i class="stat-sep"></i>
            <div><strong>${returnedCount}</strong><span>已归还</span></div>
            <i class="stat-sep"></i>
            <div><strong>+${todayCount}</strong><span>今日新增</span></div>
          </div>
        </section>

        <section class="home-sheet">
          <div class="quick-grid">
            <button class="quick-action quick-action--lost" data-action="open-publish" data-type="lost">
              <span class="quick-icon">${icon('search')}</span>
              <span class="quick-text"><strong>我丢了东西</strong><small>发布寻物启事</small></span>
              <span class="quick-arrow">${icon('chevron-right')}</span>
            </button>
            <button class="quick-action quick-action--found" data-action="open-publish" data-type="found">
              <span class="quick-icon">${icon('box')}</span>
              <span class="quick-text"><strong>我捡到东西</strong><small>登记失物招领</small></span>
              <span class="quick-arrow">${icon('chevron-right')}</span>
            </button>
          </div>

          <div class="section-head">
            <h2>最新发布</h2>
            <span class="section-count">${list.length}</span>
            <span class="section-sub">条信息</span>
            <button class="section-action" data-action="open-filter">
              ${icon('filter')}筛选${filtersActive ? ' ·' : ''}
            </button>
          </div>

          <div class="segmented" role="tablist" aria-label="信息类型">
            <button class="${state.feed.type === 'all' ? 'is-active' : ''}" data-action="set-feed-type" data-type="all" role="tab">全部 <span class="seg-count">${counts.all}</span></button>
            <button class="${state.feed.type === 'lost' ? 'is-active' : ''}" data-action="set-feed-type" data-type="lost" role="tab">寻物 <span class="seg-count">${counts.lost}</span></button>
            <button class="${state.feed.type === 'found' ? 'is-active' : ''}" data-action="set-feed-type" data-type="found" role="tab">招领 <span class="seg-count">${counts.found}</span></button>
          </div>

          <div class="chip-row">
            <button class="chip ${state.feed.category === 'all' ? 'is-active' : ''}" data-action="set-feed-cat" data-cat="all">${icon('grid')}全部</button>
            ${D.CATEGORIES.map((cat) => `<button class="chip ${state.feed.category === cat.id ? 'is-active' : ''}" data-action="set-feed-cat" data-cat="${cat.id}">${icon(cat.icon)}${cat.name}</button>`).join('')}
          </div>

          <div class="feed-list" id="feedList">
            ${shown.length ? shown.map((item) => itemCard(item)).join('') : emptyState({ image: 'assets/empty-box.svg', title: '这里还没有相关信息', text: '换个分类看看，或者发布第一条信息。', actionLabel: '发布信息', action: 'open-publish', type: 'lost' })}
          </div>
          <div id="feedFooter">${feedFooterHTML(list.length)}</div>
        </section>
      </div>
      ${tabbar('home')}
    </div>`;
  }

  function feedFooterHTML(total) {
    if (state.feed.visible < total) {
      return `<div class="feed-end" data-action="load-more">下滑查看更多 ${icon('chevron-down')}</div>`;
    }
    if (total === 0) return '';
    return `<div class="feed-end">已经到底啦 · 共 ${total} 条</div>`;
  }

  /* ============================== 搜索页 ============================== */

  function renderSearch() {
    return `<div class="view view--search">
      ${statusbar('light')}
      <header class="search-topbar">
        <button class="icon-btn" data-action="back" aria-label="返回">${icon('chevron-left')}</button>
        <div class="search-field">
          ${icon('search')}
          <input id="searchInput" type="search" placeholder="搜索物品、地点或关键词" value="${esc(state.search.query)}" autocomplete="off" aria-label="搜索">
          <button class="search-clear ${state.search.query ? '' : 'hidden'}" id="searchClear" data-action="clear-search" aria-label="清空">${icon('close')}</button>
        </div>
        <button class="search-cancel" data-action="back">取消</button>
      </header>
      <div class="view-scroll search-body" id="searchBody">${searchBodyHTML()}</div>
    </div>`;
  }

  function searchBodyHTML() {
    const q = state.search.query.trim();
    if (!q) {
      const history = (db.searchHistory || []).slice(0, 6);
      return `<div class="search-block">
          <div class="search-block-head"><h3>最近搜索</h3>${history.length ? '<button data-action="clear-history">清空</button>' : ''}</div>
          ${history.length ? `<div class="hot-terms">${history.map((h) => `<button class="hot-term" data-action="search-term" data-q="${esc(h)}">${icon('clock')}${esc(h)}</button>`).join('')}</div>` : `<p class="search-tip" style="margin-top:0">还没有搜索记录。试试搜索「校园卡」或「图书馆」。</p>`}
        </div>
        <div class="search-block">
          <div class="search-block-head"><h3>热门搜索</h3><span style="font-size:9px;color:#b2bccc">大家都在找</span></div>
          <div class="hot-list">
            ${D.HOT_SEARCHES.map((h, i) => `<button class="hot-row" data-action="search-term" data-q="${esc(h)}">
              <span class="rank ${i < 3 ? 'rank--top' : ''}">${pad(i + 1)}</span>
              <span class="hot-name">${esc(h)}</span>
              ${icon('chevron-right')}
            </button>`).join('')}
          </div>
        </div>
        <div class="search-block">
          <div class="search-block-head"><h3>按分类找</h3></div>
          <div class="hot-terms">
            ${D.CATEGORIES.map((cat) => `<button class="hot-term" data-action="search-category" data-cat="${cat.id}">${icon(cat.icon)}${cat.name}</button>`).join('')}
          </div>
        </div>
        <p class="search-tip">${icon('info')} 搜索会匹配物品名称、特征描述、地点与分类，按发布时间倒序展示。</p>`;
    }

    const results = searchItems(q);
    return `<div class="search-result-head"><span>搜索「<strong>${esc(q)}</strong>」</span><span>找到 <strong>${results.length}</strong> 条</span></div>
      ${results.length
        ? `<div class="stack-list">${results.map((item) => searchResultCard(item, q)).join('')}</div>`
        : `<div class="search-empty">${emptyState({ image: 'assets/empty-search.svg', title: '没有找到相关物品', text: '试试更短的关键词，或换个说法，比如「卡」「耳机」「伞」。', actionLabel: '发布寻物', action: 'open-publish', type: 'lost' })}</div>`}
      <div class="search-tip">找不到？你可以发布一条信息，让捡到的同学主动联系你。</div>`;
  }

  function searchResultCard(item, q) {
    const cat = categoryById(item.category);
    const st = statusInfo(item);
    return `<a class="item-card" href="${routeHash({ name: 'detail', id: item.id })}" data-action="open-item" data-id="${esc(item.id)}">
      <div class="item-thumb"><img src="${esc(item.images[0] || D.ITEM_IMAGES.fallback)}" alt="" loading="lazy" onerror="this.src='${D.ITEM_IMAGES.fallback}'"><span class="item-type item-type--${item.type}">${typeLabel(item.type)}</span></div>
      <div class="item-main">
        <div class="item-top"><span class="item-status ${st.dot === 'returned' ? 'item-status--returned' : ''}"><i></i>${st.text}</span></div>
        <h3>${highlight(item.title, q)}</h3>
        <p class="item-meta">${icon('location')}<span>${highlight(item.location, q)}</span><i class="meta-sep"></i>${icon('clock')}<span>${relativeTime(item.createdAt)}</span></p>
        <div class="item-foot"><span class="cat">${esc(cat.name)}</span><span class="views">${icon('eye')}${item.views}</span><span class="foot-new">${esc(userById(item.ownerId).name)}</span></div>
      </div>
    </a>`;
  }

  function updateSearchResults() {
    const body = document.getElementById('searchBody');
    if (body) body.innerHTML = searchBodyHTML();
    const clear = document.getElementById('searchClear');
    if (clear) clear.classList.toggle('hidden', !state.search.query);
  }

  function doSearchTerm(term) {
    state.search.query = term;
    const input = document.getElementById('searchInput');
    if (input) input.value = term;
    const history = db.searchHistory || [];
    db.searchHistory = [term, ...history.filter((h) => h !== term)].slice(0, 8);
    saveOrWarn();
    updateSearchResults();
    if (input) input.focus();
  }

  /* ============================== 详情页 ============================== */

  function renderDetail() {
    const item = itemById(state.route.id);
    if (!item) {
      return `<div class="view view--page">${statusbar('light')}${topbar('物品详情')}<div class="view-scroll">${emptyState({ title: '这条信息不存在', text: '它可能已被删除或下架。', actionLabel: '返回首页', action: 'go-home' })}</div></div>`;
    }
    const cat = categoryById(item.category);
    const owner = userById(item.ownerId);
    const st = statusInfo(item);
    const mine = item.ownerId === db.currentUserId;
    const claim = claimByMe(item.id);
    const claims = claimsForItem(item.id);
    const pendingClaims = claims.filter((c) => c.status === 'pending');
    const approvedClaim = claims.find((c) => c.status === 'approved' || c.status === 'returned');
    const canRevealContact = mine || !item.contactVisibility || item.contactVisibility === 'masked' || (claim && (claim.status === 'approved' || claim.status === 'returned'));
    const desc = item.description || '发布者没有留下更多描述。';

    return `<div class="view view--detail">
      ${statusbar('transparent')}
      <div class="detail-scroll">
        <section class="detail-hero">
          <div class="detail-gallery" id="detailGallery">
            ${(item.images.length ? item.images : [D.ITEM_IMAGES.fallback]).map((src) => `<img src="${esc(src)}" alt="${esc(item.title)}" onerror="this.src='${D.ITEM_IMAGES.fallback}'">`).join('')}
          </div>
          <div class="detail-nav">
            <div class="detail-nav-group">
              <button class="icon-btn icon-btn--ghost" data-action="back" aria-label="返回">${icon('chevron-left')}</button>
            </div>
            <div class="detail-nav-group">
              <button class="icon-btn icon-btn--ghost" data-action="share" aria-label="分享">${icon('share')}</button>
              <button class="icon-btn icon-btn--ghost" data-action="toggle-favorite" data-id="${esc(item.id)}" aria-label="收藏">${icon(isFavorite(item.id) ? 'heart-fill' : 'heart')}</button>
            </div>
          </div>
          <span class="detail-type-float ${item.type === 'found' ? 'detail-type-float--found' : ''}"><i></i>${item.type === 'lost' ? '寻物启事' : '失物招领'}</span>
          ${item.images.length > 1 ? `<div class="detail-dots" id="detailDots">${item.images.map((_, i) => `<i class="${i === 0 ? 'is-active' : ''}"></i>`).join('')}</div>` : ''}
        </section>

        <div class="detail-body">
          <div class="detail-card">
            <div class="detail-title-row">
              <h1>${esc(item.title)}</h1>
              <span class="badge badge--${item.type === 'lost' ? 'lost' : 'found'}">${typeLabel(item.type)}</span>
            </div>
            <div class="anti-fraud-row">
              <span class="anti-fraud-item">${icon('shield')}${item.questionCount || (item.questions && item.questions.length) || 0 ? `${item.questionCount || item.questions.length} 道防冒领核验` : '未设置核验题'}</span>
              <span class="anti-fraud-item">${icon('key')}交接码双确认</span>
              <span class="anti-fraud-item anti-fraud-item--ok">${icon('lock')}联系方式受控</span>
            </div>
            <div class="detail-meta-grid">
              <div class="detail-meta">${icon('location')}<div><span>${item.type === 'lost' ? '丢失地点' : '拾获地点'}</span><strong>${esc(item.location)}</strong></div></div>
              <div class="detail-meta">${icon('clock')}<div><span>${item.type === 'lost' ? '丢失时间' : '拾获时间'}</span><strong>${fullDate(item.occurredAt)}</strong></div></div>
              <div class="detail-meta">${icon('tag')}<div><span>物品分类</span><strong>${esc(cat.name)}</strong></div></div>
              <div class="detail-meta">${icon('eye')}<div><span>浏览与状态</span><strong>${item.views} 次 · ${st.text}</strong></div></div>
            </div>

            <div class="detail-section">
              <h3>${item.type === 'lost' ? '失物描述' : '物品描述'}</h3>
              <p class="detail-desc">${esc(desc)}</p>
              ${item.highlights && item.highlights.length ? `<div class="highlight-tags">${item.highlights.map((h) => `<span class="highlight-tag">${icon('check')}${esc(h)}</span>`).join('')}</div>` : ''}
            </div>

            ${matchesPanel(item)}

            <div class="detail-divider"></div>

            <div class="publisher">
              ${avatar(owner)}
              <div class="publisher-info">
                <div class="publisher-name">${esc(owner.name)}${owner.verified ? icon('verified') : ''}${trustPill(owner)}</div>
                <div class="publisher-sub">${esc(owner.college)} · ${owner.verified ? '已通过校园认证' : '未认证用户'}</div>
              </div>
              <div class="publisher-stat"><strong>${db.items.filter((i) => i.ownerId === owner.id).length}</strong>条发布</div>
            </div>

            <div class="safety-note">${icon('shield')}<span>请当面核对物品特征后再交接，避免冒领。遇到可疑情况可向校园服务中心反馈。</span></div>
            ${!mine ? `<div class="detail-report"><button class="text-btn" data-action="open-report" data-id="${esc(item.id)}">${icon('flag')}举报信息</button></div>` : ''}
          </div>
        </div>
      </div>
      ${detailActions(item, mine, claim, claims, pendingClaims, approvedClaim, canRevealContact)}
    </div>`;
  }

  function matchesPanel(item) {
    if (!apiMode) return '';
    const matches = state.matches[item.id];
    if (!matches) {
      return `<div class="detail-section match-panel"><h3>智能匹配</h3><div class="match-loading"><span class="spinner spinner--dark"></span>正在比对同分类、同时段的招领信息…</div></div>`;
    }
    if (!matches.length) return '';
    return `<div class="detail-section match-panel">
      <h3>智能匹配 · 可能相关</h3>
      <div class="match-list">${matches.map((m) => `<button class="match-card" data-action="open-item" data-id="${esc(m.id)}">
        <img src="${esc((m.images && m.images[0]) || D.ITEM_IMAGES.fallback)}" alt="" onerror="this.src='${D.ITEM_IMAGES.fallback}'">
        <span class="match-main"><strong>${esc(m.title)}</strong><small>${esc(m.location)} · ${relativeTime(m.createdAt)}</small><em>${esc((m.matchReasons || []).join(' · '))}</em></span>
        <span class="match-score">${m.matchScore}<small>匹配</small></span>
      </button>`).join('')}</div>
    </div>`;
  }

  async function loadMatches(item) {
    if (!apiMode || !item || state.matches[item.id] !== undefined) return;
    state.matches[item.id] = null;
    try {
      const data = await API.matches(item.id);
      state.matches[item.id] = Array.isArray(data.matches) ? data.matches : [];
    } catch (error) {
      state.matches[item.id] = [];
    }
    if (state.route.name === 'detail' && state.route.id === item.id) render();
  }

  function detailActions(item, mine, claim, claims, pendingClaims, approvedClaim, canRevealContact) {
    const st = statusInfo(item);
    if (mine) {
      return `<div class="detail-actions">
        <button class="icon-btn" data-action="toggle-favorite" data-id="${esc(item.id)}" aria-label="收藏">${icon(isFavorite(item.id) ? 'heart-fill' : 'heart')}</button>
        <button class="icon-btn" data-action="edit-item" data-id="${esc(item.id)}" aria-label="编辑">${icon('edit')}</button>
        ${item.status === 'returned'
          ? `<button class="btn btn--ghost" disabled>${icon('check-circle')}该物品已归还</button>`
          : `<button class="btn btn--primary" data-action="manage-claims" data-id="${esc(item.id)}">${icon('message')}${pendingClaims.length ? `管理认领 · ${pendingClaims.length}` : '管理认领'}</button>`}
      </div>`;
    }
    if (item.status === 'returned') {
      return `<div class="detail-actions">
        <button class="icon-btn" data-action="toggle-favorite" data-id="${esc(item.id)}" aria-label="收藏">${icon(isFavorite(item.id) ? 'heart-fill' : 'heart')}</button>
        <button class="btn btn--ghost" disabled>${icon('check-circle')}物品已归还</button>
      </div>`;
    }
    if (item.status === 'claimed' && !claim) {
      return `<div class="detail-actions">
        <button class="icon-btn" data-action="toggle-favorite" data-id="${esc(item.id)}" aria-label="收藏">${icon(isFavorite(item.id) ? 'heart-fill' : 'heart')}</button>
        <button class="btn btn--ghost" data-action="contact" data-id="${esc(item.id)}">${icon('phone')}联系发布者</button>
        <button class="btn btn--soft" disabled>${icon('shield')}已有认领人</button>
      </div>`;
    }
    if (claim) {
      const cst = claimStatusInfo(claim.status);
      return `<div class="detail-actions">
        <button class="icon-btn" data-action="toggle-favorite" data-id="${esc(item.id)}" aria-label="收藏">${icon(isFavorite(item.id) ? 'heart-fill' : 'heart')}</button>
        <div class="detail-claim-state">${icon(claim.status === 'approved' ? 'check-circle' : 'clock')} <span><strong>认领${cst.text}</strong> · ${cst.hint}</span></div>
        <button class="btn btn--primary" data-action="contact" data-id="${esc(item.id)}">${icon('phone')}联系TA</button>
      </div>`;
    }
    return `<div class="detail-actions">
      <button class="icon-btn" data-action="toggle-favorite" data-id="${esc(item.id)}" aria-label="收藏">${icon(isFavorite(item.id) ? 'heart-fill' : 'heart')}</button>
      <button class="btn btn--ghost" data-action="contact" data-id="${esc(item.id)}">${icon('phone')}联系</button>
      <button class="btn btn--primary" data-action="open-claim" data-id="${esc(item.id)}">${icon('shield')}我要认领</button>
    </div>`;
  }

  function bumpViews(item) {
    if (!item) return;
    if (state.lastViewedId === item.id) return;
    item.views = (item.views || 0) + 1;
    delete item._counted;
    state.lastViewedId = item.id;
    D.save(db);
  }

  /* ============================== 发布页 ============================== */

  function blankForm(type) {
    const now = new Date();
    return {
      id: null,
      mode: 'create',
      type: type || 'lost',
      title: '',
      category: '',
      location: '',
      date: dateInputValue(now.toISOString()),
      time: timeInputValue(now.toISOString()),
      description: '',
      images: [],
      phone: me().phone,
      wechat: me().wechat,
      contactVisibility: 'masked',
      questions: [{ q: '', a: '' }],
      agree: false,
      errors: {},
      completed: false,
      submitting: false,
      draftRestored: false
    };
  }

  function formFromItem(item) {
    return {
      id: item.id,
      mode: 'edit',
      type: item.type,
      title: item.title,
      category: item.category,
      location: item.location,
      date: dateInputValue(item.occurredAt),
      time: timeInputValue(item.occurredAt),
      description: item.description,
      images: item.images.slice(),
      phone: userById(item.ownerId).phone,
      wechat: userById(item.ownerId).wechat,
      contactVisibility: item.contactVisibility || 'masked',
      questions: (item.questionDetails || item.questions || []).map((entry) => ({
        q: typeof entry === 'string' ? entry : entry.q || '',
        a: typeof entry === 'string' ? '' : entry.a || ''
      })),
      agree: true,
      errors: {},
      completed: false,
      submitting: false,
      draftRestored: false
    };
  }

  function preparePublish(route) {
    if (route.id) {
      const item = itemById(route.id);
      if (item) {
        if (!state.form || state.form.id !== item.id) state.form = formFromItem(item);
        return;
      }
    }
    const type = route.type === 'found' ? 'found' : 'lost';
    if (!state.form || state.form.completed || state.form.type !== type || state.form.mode === 'edit') {
      state.form = blankForm(type);
    }
  }

  function renderPublish() {
    const f = state.form || blankForm('lost');
    if (!f) return '';
    const editing = f.mode === 'edit';
    const title = editing ? '编辑信息' : f.type === 'lost' ? '发布寻物' : '发布招领';
    const draft = !editing ? (db.drafts || []).find((d) => d.type === f.type) : null;
    const err = f.errors || {};
    return `<div class="view view--publish">
      ${statusbar('light')}
      ${topbar(title, {
        right: `<button class="text-btn" data-action="save-draft">存草稿</button>`
      })}
      <div class="view-scroll form-scroll">
        ${draft && draft.title && !f.draftRestored ? `<div class="draft-hint">${icon('edit')}发现一条未提交的${typeLabel(draft.type)}草稿「${esc(draft.title)}」<button class="text-btn" style="margin-left:auto;font-size:10px" data-action="restore-draft" data-id="${esc(draft.id)}">恢复</button></div>` : ''}
        <div class="publish-type">
          <button class="publish-type--lost ${f.type === 'lost' ? 'is-active' : ''}" data-action="switch-publish-type" data-type="lost">
            <span class="type-dot">${icon('search')}</span>
            <span><strong>我丢了东西</strong><small>发布寻物启事</small></span>
          </button>
          <button class="publish-type--found ${f.type === 'found' ? 'is-active' : ''}" data-action="switch-publish-type" data-type="found">
            <span class="type-dot">${icon('box')}</span>
            <span><strong>我捡到东西</strong><small>登记失物招领</small></span>
          </button>
        </div>

        <section class="form-card">
          <div class="form-card-head"><span class="step-num">01</span><h3>物品照片</h3><span>${f.images.length}/3</span></div>
          <div class="photo-grid ${f.images.length ? '' : 'photo-grid--empty'}">
            ${f.images.map((src, i) => `<div class="photo-slot">
              <img src="${esc(src)}" alt="物品照片 ${i + 1}" onerror="this.src='${D.ITEM_IMAGES.fallback}'">
              ${i === 0 ? '<span class="photo-cover">封面</span>' : ''}
              <button class="photo-remove" data-action="photo-remove" data-index="${i}" aria-label="删除照片">${icon('close')}</button>
            </div>`).join('')}
            ${f.images.length < 3 ? `<button class="photo-add" data-action="photo-add">${icon('camera')}<strong>${f.images.length ? '继续添加' : '上传物品照片'}</strong><small>${f.images.length ? '最多 3 张' : '点击上传，最多 3 张，建议拍清特征'}</small></button>` : ''}
          </div>
          <input type="file" id="photoInput" accept="image/*" multiple class="hidden" aria-label="上传物品照片">
          ${err.images ? `<div class="field-error">${icon('alert')}${esc(err.images)}</div>` : ''}
          <div class="photo-tip">${icon('info')}建议拍摄物品全貌与明显特征，避免泄露证件号码等敏感信息。</div>
        </section>

        <section class="form-card">
          <div class="form-card-head"><span class="step-num">02</span><h3>基本信息</h3></div>
          <div class="field">
            <label class="field-label" for="pubTitle">物品名称<em>*</em><span class="field-count" id="titleCount">${f.title.length}/30</span></label>
            <div class="input-wrap ${err.title ? 'input-wrap--error' : ''}">${icon('tag')}<input id="pubTitle" data-form="title" maxlength="30" placeholder="例如：蓝色卡套校园卡" value="${esc(f.title)}" autocomplete="off"></div>
            ${err.title ? `<div class="field-error">${icon('alert')}${esc(err.title)}</div>` : ''}
          </div>
          <div class="field">
            <label class="field-label">物品分类<em>*</em></label>
            <div class="cat-picker">
              ${D.CATEGORIES.map((cat) => `<button class="${f.category === cat.id ? 'is-active' : ''}" data-action="choose-category" data-cat="${cat.id}">${icon(cat.icon)}${cat.name}</button>`).join('')}
            </div>
            ${err.category ? `<div class="field-error">${icon('alert')}${esc(err.category)}</div>` : ''}
          </div>
        </section>

        <section class="form-card">
          <div class="form-card-head"><span class="step-num">03</span><h3>${f.type === 'lost' ? '丢失信息' : '拾获信息'}</h3></div>
          <div class="field">
            <label class="field-label">${f.type === 'lost' ? '丢失地点' : '拾获地点'}<em>*</em></label>
            <button class="select-trigger ${f.location ? 'has-value' : ''}" data-action="open-location">
              ${icon('location')}<span class="select-value">${esc(f.location || '选择校园地点')}</span>${icon('chevron-down', 'chevron')}
            </button>
            ${err.location ? `<div class="field-error">${icon('alert')}${esc(err.location)}</div>` : ''}
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">${f.type === 'lost' ? '丢失日期' : '拾获日期'}<em>*</em></label>
              <div class="input-wrap ${err.date ? 'input-wrap--error' : ''}">${icon('calendar')}<input type="date" data-form="date" value="${esc(f.date)}" max="${dateInputValue(new Date().toISOString())}"></div>
              ${err.date ? `<div class="field-error">${icon('alert')}${esc(err.date)}</div>` : ''}
            </div>
            <div class="field">
              <label class="field-label">具体时间<em>*</em></label>
              <div class="input-wrap ${err.time ? 'input-wrap--error' : ''}">${icon('clock')}<input type="time" data-form="time" value="${esc(f.time)}"></div>
              ${err.time ? `<div class="field-error">${icon('alert')}${esc(err.time)}</div>` : ''}
            </div>
          </div>
        </section>

        <section class="form-card">
          <div class="form-card-head"><span class="step-num">04</span><h3>特征描述</h3><span>越详细越容易匹配</span></div>
          <div class="field">
            <div class="textarea-wrap ${err.description ? 'textarea-wrap--error' : ''}">
              <textarea class="textarea" id="pubDesc" data-form="description" maxlength="300" placeholder="描述物品的颜色、品牌、明显特征，以及丢失/拾获的经过。请勿填写身份证号、银行卡号等敏感信息。">${esc(f.description)}</textarea>
              <div class="textarea-foot"><span>至少 10 个字</span><span class="char-count" id="descCount">${f.description.length}/300</span></div>
            </div>
            ${err.description ? `<div class="field-error">${icon('alert')}${esc(err.description)}</div>` : ''}
          </div>
        </section>

        <section class="form-card">
          <div class="form-card-head"><span class="step-num">05</span><h3>防冒领核验</h3><span>选填 · 最多 3 题</span></div>
          <p class="field-help" style="margin:0 0 11px">设置只有真正失主/拾获者才知道的问题。答案只在服务端比对，不公开展示；认领人必须答对后才进入发布者审核。</p>
          <div class="question-editor">
            ${(f.questions || []).map((entry, index) => `<div class="question-row">
              <div class="field"><label class="field-label">核验题 ${index + 1}</label><div class="input-wrap">${icon('help')}<input data-question-q="${index}" maxlength="80" placeholder="例如：卡套背面是什么图案？" value="${esc(entry.q || '')}"></div></div>
              <div class="field"><label class="field-label">标准答案</label><div class="input-wrap">${icon('lock')}<input data-question-a="${index}" maxlength="80" placeholder="多个答案用 | 分隔" value="${esc(entry.a || '')}"></div></div>
              <button class="question-remove" data-action="remove-question" data-index="${index}" aria-label="删除核验题">${icon('trash')}</button>
            </div>`).join('')}
          </div>
          ${(f.questions || []).length < 3 ? `<button class="question-add" data-action="add-question">${icon('plus')}添加一道核验题</button>` : ''}
          ${err.questions ? `<div class="field-error">${icon('alert')}${esc(err.questions)}</div>` : ''}
        </section>

        <section class="form-card">
          <div class="form-card-head"><span class="step-num">06</span><h3>联系方式</h3><span>仅用于认领对接</span></div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">手机号<em>*</em></label>
              <div class="input-wrap ${err.phone ? 'input-wrap--error' : ''}">${icon('phone')}<input type="tel" data-form="phone" maxlength="11" placeholder="11 位手机号" value="${esc(f.phone)}"></div>
              ${err.phone ? `<div class="field-error">${icon('alert')}${esc(err.phone)}</div>` : ''}
            </div>
            <div class="field">
              <label class="field-label">微信号<span class="field-optional">选填</span></label>
              <div class="input-wrap">${icon('wechat')}<input data-form="wechat" maxlength="24" placeholder="方便对方添加" value="${esc(f.wechat)}"></div>
            </div>
          </div>
          <div class="contact-visibility">
            <button class="radio-card ${f.contactVisibility === 'masked' ? 'is-active' : ''}" data-action="set-contact-visibility" data-value="masked">
              <span class="radio-dot"></span>
              <span><strong>所有人可见（脱敏）</strong><small>显示 138****6621，点击后可查看完整号码</small></span>
            </button>
            <button class="radio-card ${f.contactVisibility === 'private' ? 'is-active' : ''}" data-action="set-contact-visibility" data-value="private">
              <span class="radio-dot"></span>
              <span><strong>仅认领通过后可见</strong><small>降低骚扰风险，认领人需先通过特征核验</small></span>
            </button>
          </div>
        </section>

        <div class="agree-row">
          <button class="checkbox ${f.agree ? 'is-checked' : ''}" data-action="toggle-agree" aria-label="同意协议">${icon('check')}</button>
          <span>我已阅读并同意《杭电失物招领系统公约》，承诺信息真实、当面核验、不冒领他人财物。${err.agree ? `<span style="color:#d94a60"> ${esc(err.agree)}</span>` : ''}</span>
        </div>
      </div>
      <div class="sticky-actions">
        <button class="btn btn--ghost" data-action="save-draft">存草稿</button>
        <button class="btn btn--primary" data-action="submit-publish" ${f.submitting ? 'disabled' : ''}>
          ${f.submitting ? '<span class="spinner"></span>正在提交' : icon('send') + (editing ? '保存修改' : '立即发布')}
        </button>
      </div>
    </div>`;
  }

  function validateForm() {
    const f = state.form;
    const errors = {};
    if (!f.title.trim()) errors.title = '请填写物品名称';
    else if (f.title.trim().length < 4) errors.title = '名称至少 4 个字';
    if (!f.category) errors.category = '请选择物品分类';
    if (!f.location) errors.location = '请选择丢失或拾获地点';
    if (!f.date) errors.date = '请选择日期';
    if (!f.time) errors.time = '请选择时间';
    if (f.date && f.time) {
      const dt = new Date(`${f.date}T${f.time}:00`);
      if (Number.isNaN(dt.getTime())) errors.time = '时间格式不正确';
      else if (dt.getTime() > Date.now() + 5 * 60 * 1000) {
        errors.date = '时间不能晚于现在';
      }
    }
    if (!f.description.trim()) errors.description = '请补充物品特征描述';
    else if (f.description.trim().length < 10) errors.description = '描述至少 10 个字，方便核对';
    if (!f.phone.trim()) errors.phone = '请填写联系电话';
    else if (!/^1[3-9]\d{9}$/.test(normalizePhone(f.phone))) errors.phone = '请填写有效的 11 位手机号';
    if (!f.images.length) errors.images = '请至少上传 1 张物品照片';
    const questions = (f.questions || []).filter((q) => (q.q || '').trim() || (q.a || '').trim());
    if (questions.some((q) => !(q.q || '').trim() || !(q.a || '').trim())) {
      errors.questions = '核验题和标准答案需要成对填写';
    }
    if (questions.length > 3) errors.questions = '最多设置 3 道核验题';
    if (!f.agree) errors.agree = '请先同意公约';
    f.errors = errors;
    return Object.keys(errors).length === 0;
  }

  async function handleSubmitPublish(btn) {
    const f = state.form;
    if (!f || f.submitting) return;
    f.errors = {};
    if (!validateForm()) {
      render();
      requestAnimationFrame(() => {
        const first = app.querySelector('.field-error');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      toast('还有必填项未完成，请检查一下', 'warn');
      return;
    }
    f.submitting = true;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>正在提交';
    }
    const when = new Date(`${f.date}T${f.time}:00`).toISOString();
    const questionPayload = (f.questions || [])
      .map((q) => ({ q: (q.q || '').trim(), a: (q.a || '').trim() }))
      .filter((q) => q.q && q.a);
    const payload = {
      type: f.type,
      title: f.title.trim(),
      category: f.category,
      location: f.location,
      occurredAt: when,
      description: f.description.trim(),
      images: f.images.slice(),
      contactVisibility: f.contactVisibility,
      phone: normalizePhone(f.phone),
      wechat: f.wechat.trim(),
      questions: questionPayload
    };
    if (apiMode) {
      try {
        const result = f.mode === 'edit' && f.id ? await API.updateItem(f.id, payload) : await API.createItem(payload);
        await syncFromApi(false);
        f.submitting = false;
        f.completed = true;
        if (result.matches && result.matches.length) {
          state.matches = { ...(state.matches || {}), [result.item.id]: result.matches };
          toast(`发布成功，系统找到 ${result.matches.length} 条可能匹配`);
        }
        removeSuccess();
        showSuccess(result.item, f.mode === 'edit' ? 'edit' : 'publish');
        state.form = blankForm(f.type);
      } catch (error) {
        f.submitting = false;
        apiError(error);
        render();
      }
      return;
    }
    setTimeout(() => {
      const when = new Date(`${f.date}T${f.time}:00`).toISOString();
      if (f.mode === 'edit' && f.id) {
        const item = itemById(f.id);
        if (item) {
          item.title = f.title.trim();
          item.type = f.type;
          item.category = f.category;
          item.location = f.location;
          item.occurredAt = when;
          item.description = f.description.trim();
          item.images = f.images.slice();
          item.contactVisibility = f.contactVisibility;
        }
        const owner = userById(f.id ? itemById(f.id).ownerId : db.currentUserId);
        if (owner) {
          owner.phone = normalizePhone(f.phone);
          owner.wechat = f.wechat.trim();
        }
        f.submitting = false;
        f.completed = true;
        saveOrWarn();
        toast('修改已保存');
        removeSuccess();
        showSuccess(item, 'edit');
        state.form = blankForm(f.type);
      } else {
        const item = {
          id: uid('it'),
          type: f.type,
          title: f.title.trim(),
          category: f.category,
          location: f.location,
          occurredAt: when,
          createdAt: new Date().toISOString(),
          description: f.description.trim(),
          images: f.images.slice(),
          status: 'active',
          ownerId: db.currentUserId,
          views: 0,
          urgent: false,
          contactVisibility: f.contactVisibility,
          highlights: []
        };
        db.items.unshift(item);
        const owner = me();
        owner.phone = normalizePhone(f.phone);
        owner.wechat = f.wechat.trim();
        db.notifications.unshift({
          id: uid('nt'),
          type: 'system',
          title: `「${item.title}」发布成功`,
          body: '信息已展示在首页，等待热心的杭电同学回应。',
          createdAt: new Date().toISOString(),
          read: false,
          itemId: item.id
        });
        db.drafts = (db.drafts || []).filter((d) => d.type !== f.type);
        f.submitting = false;
        f.completed = true;
        saveOrWarn();
        removeSuccess();
        showSuccess(item, 'publish');
        state.form = blankForm(f.type);
      }
    }, 520);
  }

  /* ============================== 个人中心 ============================== */

  function renderProfile() {
    const user = me();
    const posted = db.items.filter((i) => i.ownerId === user.id).length;
    const claims = db.claims.filter((c) => c.claimantId === user.id).length;
    const unread = unreadCount();
    return `<div class="view view--profile">
      ${statusbar('profile')}
      <div class="profile-scroll">
        <section class="profile-hero">
          <div class="profile-topbar">
            <h1>个人中心</h1>
            <button class="icon-btn" data-nav="settings" aria-label="设置">${icon('settings')}</button>
          </div>
          <div class="profile-head">
            <div class="profile-avatar">${esc(user.initial)}${user.verified ? `<span class="verified-dot">${icon('check')}</span>` : ''}</div>
            <div>
              <div class="profile-name-row"><h2>${esc(user.name)}</h2>${verifiedBadge(user)}
                <button class="profile-edit" data-action="open-profile-edit" aria-label="编辑个人资料">${icon('edit')}</button>
              </div>
              <div class="profile-sub">${esc(user.studentId)} · ${esc(user.college)} · ${esc(user.grade)} · ${trustPill(user)}</div>
              <p class="profile-bio">${esc(user.bio || '让每一件遗失，都有回程。')}</p>
            </div>
          </div>
          <div class="profile-stats">
            <button class="profile-stat" data-nav="my-posts"><strong>${posted}</strong><span>我的发布</span></button>
            <button class="profile-stat" data-nav="my-claims"><strong>${claims}</strong><span>我的认领</span></button>
            <button class="profile-stat" data-nav="favorites"><strong>${db.favorites.length}</strong><span>我的收藏</span></button>
          </div>
        </section>

        <div class="profile-body">
          <div class="identity-banner">
            <span class="identity-icon">${icon('shield')}</span>
            <div><strong>校园身份已认证</strong><small>学号 ${esc(user.studentId)} · 杭州电子科技大学</small></div>
            <button class="text-btn" data-nav="security">查看</button>
          </div>

          <div class="menu-card">
            <button class="menu-row" data-nav="my-posts">
              <span class="menu-icon menu-icon--blue">${icon('list')}</span>
              <span class="menu-text">我的发布</span>
              <span class="menu-sub">${posted} 条</span>${icon('chevron-right', 'menu-chevron')}
            </button>
            <button class="menu-row" data-nav="my-claims">
              <span class="menu-icon menu-icon--mint">${icon('shield')}</span>
              <span class="menu-text">我的认领</span>
              <span class="menu-sub">${claims} 条</span>${icon('chevron-right', 'menu-chevron')}
            </button>
            <button class="menu-row" data-nav="favorites">
              <span class="menu-icon menu-icon--amber">${icon('heart')}</span>
              <span class="menu-text">我的收藏</span>
              <span class="menu-sub">${db.favorites.length} 件</span>${icon('chevron-right', 'menu-chevron')}
            </button>
            <button class="menu-row" data-nav="notifications">
              <span class="menu-icon menu-icon--violet">${icon('bell')}</span>
              <span class="menu-text">消息通知</span>
              ${unread ? `<span class="menu-badge">${unread}</span>` : ''}${icon('chevron-right', 'menu-chevron')}
            </button>
          </div>

          <div class="menu-title">ACCOUNT &amp; SUPPORT</div>
          <div class="menu-card">
            <button class="menu-row" data-nav="security">
              <span class="menu-icon">${icon('lock')}</span><span class="menu-text">账户安全</span>${icon('chevron-right', 'menu-chevron')}
            </button>
            <button class="menu-row" data-nav="settings">
              <span class="menu-icon">${icon('settings')}</span><span class="menu-text">设置</span>${icon('chevron-right', 'menu-chevron')}
            </button>
            <button class="menu-row" data-nav="feedback">
              <span class="menu-icon">${icon('message')}</span><span class="menu-text">反馈与建议</span>${icon('chevron-right', 'menu-chevron')}
            </button>
            <button class="menu-row" data-nav="about">
              <span class="menu-icon">${icon('info')}</span><span class="menu-text">关于我们</span>${icon('chevron-right', 'menu-chevron')}
            </button>
          </div>

          <button class="logout-btn" data-action="logout">${icon('logout')}退出登录</button>
          <div class="profile-version">HDU LOST & FOUND · V2.0</div>
        </div>
      </div>
      ${tabbar('profile')}
    </div>`;
  }

  /* ============================== 我的发布 / 认领 / 收藏 ============================== */

  function renderMyPosts() {
    const mine = db.items.filter((i) => i.ownerId === db.currentUserId);
    const tab = state.postsTab || 'all';
    const list = mine.filter((i) => {
      if (tab === 'active') return i.status === 'active' || i.status === 'claimed';
      if (tab === 'returned') return i.status === 'returned';
      if (tab === 'offline') return i.status === 'offline';
      return true;
    });
    const counts = {
      all: mine.length,
      active: mine.filter((i) => i.status === 'active' || i.status === 'claimed').length,
      returned: mine.filter((i) => i.status === 'returned').length,
      offline: mine.filter((i) => i.status === 'offline').length
    };
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('我的发布', { right: `<button class="icon-btn" data-action="open-publish" data-type="lost" aria-label="发布">${icon('plus')}</button>` })}
      <div class="view-scroll page-scroll">
        <p class="page-intro">管理你发布的寻物与招领信息。已归还的条目会保留记录，方便回溯。</p>
        <div class="tabs">
          <button class="${tab === 'all' ? 'is-active' : ''}" data-action="posts-tab" data-tab="all">全部 <span class="tab-count">${counts.all}</span></button>
          <button class="${tab === 'active' ? 'is-active' : ''}" data-action="posts-tab" data-tab="active">进行中 <span class="tab-count">${counts.active}</span></button>
          <button class="${tab === 'returned' ? 'is-active' : ''}" data-action="posts-tab" data-tab="returned">已归还 <span class="tab-count">${counts.returned}</span></button>
          <button class="${tab === 'offline' ? 'is-active' : ''}" data-action="posts-tab" data-tab="offline">已下架 <span class="tab-count">${counts.offline}</span></button>
        </div>
        ${list.length ? `<div class="stack-list">${list.map(manageCard).join('')}</div>` : emptyState({ image: 'assets/empty-box.svg', title: '这里还没有信息', text: '发布一条寻物或招领，让更多杭电同学看到。', actionLabel: '去发布', action: 'open-publish', type: 'lost' })}
      </div>
    </div>`;
  }

  function manageCard(item) {
    const st = statusInfo(item);
    const claims = claimsForItem(item.id);
    const pending = claims.filter((c) => c.status === 'pending').length;
    const cat = categoryById(item.category);
    return `<div class="manage-card">
      <div class="manage-head">
        <button class="manage-thumb" data-action="open-item" data-id="${esc(item.id)}" aria-label="查看详情"><img src="${esc(item.images[0] || D.ITEM_IMAGES.fallback)}" alt="" onerror="this.src='${D.ITEM_IMAGES.fallback}'"></button>
        <div class="manage-info">
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.location)} · ${esc(cat.name)} · ${relativeTime(item.createdAt)}</p>
        </div>
        <span class="manage-status manage-status--${st.cls}">${st.text}</span>
      </div>
      <div class="manage-actions">
        <button class="btn btn--ghost btn--sm" data-action="edit-item" data-id="${esc(item.id)}">${icon('edit')}编辑</button>
        <button class="btn btn--soft btn--sm" data-action="manage-claims" data-id="${esc(item.id)}">${icon('message')}认领${pending ? ` · ${pending}` : ''}</button>
        ${item.status === 'offline'
          ? `<button class="btn btn--ghost btn--sm" data-action="toggle-item-status" data-id="${esc(item.id)}">${icon('refresh')}上架</button>`
          : `<button class="btn btn--ghost btn--sm" data-action="toggle-item-status" data-id="${esc(item.id)}">${icon('archive')}下架</button>`}
        <button class="btn btn--link" data-action="delete-item" data-id="${esc(item.id)}">${icon('trash')}</button>
      </div>
    </div>`;
  }

  function renderMyClaims() {
    const tab = state.claimsTab || 'mine';
    const mine = db.claims.filter((c) => c.claimantId === db.currentUserId);
    const received = db.claims.filter((c) => {
      const item = itemById(c.itemId);
      return item && item.ownerId === db.currentUserId;
    });
    const list = tab === 'mine' ? mine : received;
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('我的认领')}
      <div class="view-scroll page-scroll">
        <p class="page-intro">认领需要先通过防冒领核验。发布者确认后会生成一次性交接码；认领人输入交接码、发布者确认后，物品才会归档为「已归还」。</p>
        <div class="tabs">
          <button class="${tab === 'mine' ? 'is-active' : ''}" data-action="claims-tab" data-tab="mine">我发起的 <span class="tab-count">${mine.length}</span></button>
          <button class="${tab === 'received' ? 'is-active' : ''}" data-action="claims-tab" data-tab="received">我收到的 <span class="tab-count">${received.length}</span></button>
        </div>
        ${list.length ? `<div class="stack-list">${list.map((c) => claimCard(c, tab === 'received')).join('')}</div>` : emptyState({ image: 'assets/empty-box.svg', title: tab === 'mine' ? '还没有发起认领' : '还没有收到认领', text: tab === 'mine' ? '在首页看到匹配的物品，进入详情即可发起认领。' : '当有人认领你发布的物品时，会显示在这里。', actionLabel: tab === 'mine' ? '去逛逛' : '', action: tab === 'mine' ? 'go-home' : '' })}
      </div>
    </div>`;
  }

  function claimCard(claim, received) {
    const item = itemById(claim.itemId);
    if (!item) return '';
    const cst = claimStatusInfo(claim.status);
    const other = userById(received ? claim.claimantId : item.ownerId);
    return `<div class="claim-card">
      <div class="claim-top">
        <button class="manage-thumb" data-action="open-item" data-id="${esc(item.id)}"><img src="${esc(item.images[0] || D.ITEM_IMAGES.fallback)}" alt="" onerror="this.src='${D.ITEM_IMAGES.fallback}'"></button>
        <div class="claim-title">
          <h3>${esc(item.title)}</h3>
          <p>${received ? '认领人' : '发布者'}：${esc(other.name)} · ${relativeTime(claim.createdAt)}</p>
        </div>
        <span class="manage-status manage-status--${cst.cls === 'pending' ? 'claimed' : cst.cls}">${cst.text}</span>
      </div>
      <div class="claim-owner-line">${received ? trustPill(other) : `<span class="pill-note">${icon('shield')}${esc(item.questionCount || 0)} 道核验题</span>`} ${claim.matchCount !== undefined && claim.questionCount ? `<span class="pill-note">特征匹配 ${claim.matchCount}/${claim.questionCount}</span>` : ''}</div>
      ${claimAnswerHTML(claim)}
      ${claim.note ? `<div class="claim-note">备注：${esc(claim.note)}</div>` : ''}
      ${handoverHTML(claim, received)}
      <div class="claim-actions">
        <button class="btn btn--ghost btn--sm" data-action="open-item" data-id="${esc(item.id)}">${icon('eye')}查看物品</button>
        ${received && claim.status === 'pending'
          ? `<button class="btn btn--danger btn--sm" data-action="reject-claim" data-id="${esc(claim.id)}">不通过</button>
          <button class="btn btn--primary btn--sm" data-action="approve-claim" data-id="${esc(claim.id)}">${icon('check')}通过认领</button>`
          : claim.status === 'approved' || claim.status === 'returned'
            ? `<button class="btn btn--soft btn--sm" data-action="contact-claim" data-id="${esc(claim.id)}">${icon('phone')}联系对方</button>`
            : ''}
      </div>
    </div>`;
  }

  function renderFavorites() {
    const list = db.favorites.map(itemById).filter(Boolean);
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('我的收藏')}
      <div class="view-scroll page-scroll">
        <p class="page-intro">收藏的信息会同步保留在这里，方便你随时回来核对。</p>
        ${list.length ? `<div class="stack-list">${list.map((i) => itemCard(i)).join('')}</div>` : emptyState({ image: 'assets/empty-box.svg', title: '还没有收藏', text: '在详情页点击心形按钮，就能把物品收藏到这里。', actionLabel: '去首页看看', action: 'go-home' })}
      </div>
    </div>`;
  }

  function renderNotifications() {
    const list = db.notifications.slice();
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('消息通知', { right: `<button class="text-btn" data-action="mark-all-read">全部已读</button>` })}
      <div class="view-scroll page-scroll">
        <p class="page-intro">${unreadCount() ? `你有 ${unreadCount()} 条未读消息。` : '所有消息都已读。'}点击消息可查看对应物品。</p>
        ${list.length
          ? list.map((n) => {
              const item = n.itemId ? itemById(n.itemId) : null;
              const iconName = n.type === 'claim' ? 'shield' : n.type === 'return' ? 'check-circle' : n.type === 'welcome' ? 'sparkles' : 'bell';
              const tone = n.type === 'return' ? 'mint' : n.type === 'claim' ? 'amber' : '';
              return `<button class="notice-row ${n.read ? '' : 'is-unread'}" data-action="open-notification" data-id="${esc(n.id)}">
                <span class="notice-icon ${tone ? 'notice-icon--' + tone : ''}">${icon(iconName)}</span>
                <span class="notice-body"><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><span class="notice-time">${relativeTime(n.createdAt)}${item ? ' · ' + esc(item.title) : ''}</span></span>
                ${n.read ? '' : '<i class="notice-unread"></i>'}
              </button>`;
            }).join('')
          : emptyState({ image: 'assets/empty-box.svg', title: '暂无消息', text: '认领申请、归还提醒与系统通知都会出现在这里。' })}
      </div>
    </div>`;
  }

  function renderSettings() {
    const s = db.settings;
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('设置')}
      <div class="view-scroll page-scroll">
        <div class="settings-card">
          <div class="settings-row"><div class="settings-text"><strong>新消息通知</strong><small>有人认领或联系时提醒我</small></div><button class="switch ${s.notifyNew ? 'is-on' : ''}" data-action="toggle-setting" data-key="notifyNew" aria-label="新消息通知"></button></div>
          <div class="settings-row"><div class="settings-text"><strong>认领结果提醒</strong><small>认领通过或未通过时通知我</small></div><button class="switch ${s.notifyClaim ? 'is-on' : ''}" data-action="toggle-setting" data-key="notifyClaim" aria-label="认领结果提醒"></button></div>
          <div class="settings-row"><div class="settings-text"><strong>联系方式脱敏</strong><small>默认隐藏手机号中间四位</small></div><button class="switch ${s.maskContact ? 'is-on' : ''}" data-action="toggle-setting" data-key="maskContact" aria-label="联系方式脱敏"></button></div>
          <div class="settings-row"><div class="settings-text"><strong>轻触反馈</strong><small>操作时使用轻微震动（演示）</small></div><button class="switch ${s.haptic ? 'is-on' : ''}" data-action="toggle-setting" data-key="haptic" aria-label="轻触反馈"></button></div>
        </div>

        <div class="menu-title">DATA &amp; PRIVACY</div>
        <div class="settings-card">
          <button class="settings-row" data-action="clear-history"><div class="settings-text"><strong>清空搜索历史</strong><small>不会删除发布与认领记录</small></div>${icon('chevron-right', 'menu-chevron')}</button>
          <button class="settings-row" data-action="reset-demo"><div class="settings-text"><strong>重置演示数据</strong><small>恢复初始的 12 条示例信息</small></div>${icon('refresh', 'menu-chevron')}</button>
        </div>

        <div class="menu-title">HELP &amp; ABOUT</div>
        <div class="settings-card">
          <button class="settings-row" data-action="open-guide"><div class="settings-text"><strong>使用指南</strong><small>30 秒了解发布与认领流程</small></div>${icon('help', 'menu-chevron')}</button>
          <button class="settings-row" data-nav="about"><div class="settings-text"><strong>关于杭电失物招领系统</strong><small>版本、设计与数据说明</small></div>${icon('chevron-right', 'menu-chevron')}</button>
        </div>

        <div class="settings-card" style="margin-top:10px">
          <button class="settings-row" data-action="logout"><div class="settings-text"><strong style="color:#cf4058">退出登录</strong><small>将返回校园身份认证页</small></div>${icon('logout', 'menu-chevron')}</button>
        </div>
        <div class="profile-version">HDU LOST & FOUND · V2.0</div>
      </div>
    </div>`;
  }

  function renderSecurity() {
    const user = me();
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('账户安全')}
      <div class="view-scroll page-scroll">
        <div class="identity-banner" style="margin-top:2px">
          <span class="identity-icon">${icon('shield')}</span>
          <div><strong>校园身份认证已通过</strong><small>${esc(user.name)} · ${esc(user.studentId)} · ${esc(user.college)}</small></div>
          ${verifiedBadge(user)}
        </div>
        <div class="menu-card" style="margin-top:10px">
          <div class="settings-row"><div class="settings-text"><strong>认证方式</strong><small>杭州电子科技大学统一身份认证</small></div><span class="pill-note">${icon('check')}已认证</span></div>
          <div class="settings-row"><div class="settings-text"><strong>登录设备</strong><small>当前设备 · iPhone · 杭州</small></div><span class="pill-note">本机</span></div>
          <button class="settings-row" data-action="change-password"><div class="settings-text"><strong>修改密码</strong><small>建议定期更换校园统一身份密码</small></div>${icon('chevron-right', 'menu-chevron')}</button>
          <button class="settings-row" data-action="logout-all"><div class="settings-text"><strong>退出其他设备</strong><small>保护账号安全</small></div>${icon('chevron-right', 'menu-chevron')}</button>
        </div>
        <div class="safety-note" style="margin-top:12px">${icon('lock')}<span>杭电失物招领系统不会在公开页面展示完整手机号；认领通过后才会向双方开放联系方式。遇到冒充、骚扰可随时反馈。</span></div>
      </div>
    </div>`;
  }

  function renderFeedback() {
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('反馈与建议')}
      <div class="view-scroll page-scroll">
        <div class="detail-card" style="background:linear-gradient(135deg,#1b4dd8,#2f6bff);color:#fff;border:0;box-shadow:0 14px 30px rgba(47,107,255,.24)">
          <h2 style="margin:0;font-size:15px;font-weight:650">${icon('sparkles')} 一起打磨杭电失物招领系统</h2>
          <p style="margin:7px 0 0;font-size:10px;line-height:1.8;color:rgba(255,255,255,.72)">杭电失物招领系统一直在持续优化中，你的建议将帮助我们更好地打磨产品。欢迎积极反馈与优化建议！</p>
        </div>
        <div class="form-card" style="margin-top:10px">
          <div class="field">
            <label class="field-label">反馈类型</label>
            <div class="choice-row">
              ${['功能建议', '问题反馈', '信息纠错', '其他'].map((c) => `<button class="choice ${state.feedbackCategory === c ? 'is-active' : ''}" data-action="feedback-category" data-value="${c}">${c}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label class="field-label">你的建议<span class="field-count" id="feedbackCount">0/200</span></label>
            <div class="textarea-wrap">
              <textarea class="textarea" id="feedbackText" maxlength="200" placeholder="描述你遇到的问题，或希望增加的功能…"></textarea>
              <div class="textarea-foot"><span>至少 5 个字</span></div>
            </div>
          </div>
          <button class="btn btn--primary btn--block" data-action="submit-feedback">${icon('send')}提交反馈</button>
        </div>
        ${db.feedback && db.feedback.length ? `<div class="menu-title">MY FEEDBACK</div><div class="stack-list">${db.feedback.slice(0, 3).map((f) => `<div class="claim-card"><div class="claim-top"><div class="claim-title"><h3>${esc(f.category)}</h3><p>${relativeTime(f.createdAt)}</p></div><span class="manage-status manage-status--returned">已收到</span></div><div class="claim-answer">${esc(f.text)}</div></div>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }

  function renderAbout() {
    return `<div class="view view--page">
      ${statusbar('light')}
      ${topbar('关于我们')}
      <div class="view-scroll page-scroll">
        <div class="about-card">
          <img src="assets/hdu-logo.jpg" alt="杭州电子科技大学">
          <h2>杭电失物招领系统</h2>
          <p>为杭州电子科技大学师生提供统一、可信、易用的失物招领平台。<br>让每一件遗失，都有回程。</p>
        </div>
        <div class="about-links">
          <div class="settings-row"><div class="settings-text"><strong>版本</strong><small>V2.0 · 2026.11</small></div><span class="pill-note">PRD V1.0 / 安全增强</span></div>
          <div class="settings-row"><div class="settings-text"><strong>设计依据</strong><small>《杭电校园失物招领系统 PRD》+ Figma 低保真设计稿</small></div></div>
          <div class="settings-row"><div class="settings-text"><strong>设计尺寸</strong><small>390 × 844 pt · 移动端 Web</small></div></div>
          <div class="settings-row"><div class="settings-text"><strong>数据说明</strong><small>${apiMode ? '登录后的信息由服务器统一保存' : '演示数据保存在浏览器本地，不会上传服务器'}</small></div></div>
        </div>
        <div class="safety-note" style="margin-top:12px">${icon('info')}<span>本项目为课程/社团作业原型，非杭州电子科技大学官方应用。校徽与校名仅用于设计语境展示。</span></div>
        <div style="text-align:center;margin-top:20px;font-size:8.5px;color:#b2bccc;font-family:var(--mono);letter-spacing:1px">DESIGNED WITH HDU BLUE · 1956—2026</div>
      </div>
    </div>`;
  }

  function renderLogin() {
    return `<div class="view view--login">
      ${statusbar('dark')}
      <div class="login-scroll">
        <div class="login-brand">
          <img src="assets/hdu-logo.jpg" alt="">
          <span><strong>杭电失物招领系统</strong><small>HDU · LOST &amp; FOUND</small></span>
        </div>
        <h1 class="login-title">先确认你是<br><span>杭电人。</span></h1>
        <p class="login-sub">接入校园统一身份认证，减少冒领与虚假信息。登录后即可发布、认领与接收归还提醒。</p>
        <div class="login-form">
          <div class="login-field">
            <label for="loginId">学号 / 工号</label>
            <div class="login-input">${icon('user')}<input id="loginId" inputmode="numeric" maxlength="12" placeholder="请输入学号" value="${esc(state.loginId)}" autocomplete="username"></div>
          </div>
          <div class="login-field">
            <label for="loginPass">统一身份认证密码</label>
            <div class="login-input">${icon('lock')}<input id="loginPass" type="password" maxlength="24" placeholder="请输入密码" value="${esc(state.loginPass)}" autocomplete="current-password"></div>
          </div>
          ${state.loginError ? `<div class="login-error">${icon('alert')}${esc(state.loginError)}</div>` : ''}
          <button class="login-btn" data-action="do-login">${icon('shield')}登录并认证</button>
          <button class="login-demo" data-action="demo-login">${icon('sparkles')}使用演示账号进入</button>
          ${apiMode ? `<div class="login-accounts">${db.users.filter((u) => u.verified).slice(0, 4).map((u) => `<button class="login-account" data-action="quick-login" data-id="${esc(u.id)}"><span>${esc(u.name)}</span><small>${esc(u.studentId)}</small></button>`).join('')}</div>` : ''}
          <div class="login-note">${icon('info')}<span>${apiMode ? '演示账号密码均为 hdu1956。可以切换不同账号，分别体验发布者与认领人的双视角。' : '演示环境不连接学校统一身份认证系统。任意 8–12 位数字学号 + 6 位以上密码即可体验；演示账号：23034112 / hdu1956。'}</span></div>
        </div>
      </div>
    </div>`;
  }

  /* ============================== 弹层：筛选 / 联系 / 认领 ============================== */

  function openSheet(type, payload) {
    state.sheet = Object.assign({ type }, payload || {});
    if (type === 'filter') {
      state.filterDraft = Object.assign(JSON.parse(JSON.stringify(state.filters)), {
        category: state.feed.category
      });
    }
    if (type === 'location') state.locationQuery = '';
    if (type === 'report') state.reportReason = '虚假信息';
    renderSheet();
  }

  function closeSheet(silent) {
    state.sheet = null;
    if (modalRoot) modalRoot.innerHTML = '';
    if (!silent) app.focus && app.focus();
  }

  function sheetShell(title, subtitle, body, foot, opts) {
    const o = opts || {};
    return `<div class="sheet-layer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-backdrop" data-action="close-sheet"></div>
      <div class="sheet-panel ${o.tall ? 'sheet-panel--tall' : 'sheet-panel--auto'}">
        <div class="sheet-handle"></div>
        <header class="sheet-head">
          <div class="sheet-head-text"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
          <button class="sheet-close" data-action="close-sheet" aria-label="关闭">${icon('close')}</button>
        </header>
        <div class="sheet-body">${body}</div>
        ${foot ? `<footer class="sheet-foot">${foot}</footer>` : ''}
      </div>
    </div>`;
  }

  function renderSheet() {
    if (!state.sheet || !modalRoot) {
      if (modalRoot) modalRoot.innerHTML = '';
      return;
    }
    const s = state.sheet;
    let html = '';
    if (s.type === 'filter') html = filterSheet();
    else if (s.type === 'contact') html = contactSheet(s.itemId);
    else if (s.type === 'claim-contact') html = claimContactSheet(s.claimId);
    else if (s.type === 'claim') html = claimSheet(s.itemId);
    else if (s.type === 'location') html = locationSheet();
    else if (s.type === 'claims') html = claimsSheet(s.itemId);
    else if (s.type === 'guide') html = guideSheet();
    else if (s.type === 'report') html = reportSheet(s.itemId);
    else if (s.type === 'profile-edit') html = profileEditSheet();
    modalRoot.innerHTML = html;
    const search = modalRoot.querySelector('#locationSearch');
    if (search) search.focus();
  }

  function filterSheet() {
    const d = state.filterDraft || state.filters;
    const resultCount = (() => {
      const oldFilters = state.filters;
      const oldCategory = state.feed.category;
      state.filters = {
        location: d.location || 'all',
        time: d.time || 'all',
        status: d.status || 'all',
        sort: d.sort || 'newest'
      };
      state.feed.category = d.category || 'all';
      const n = filteredFeed().length;
      state.filters = oldFilters;
      state.feed.category = oldCategory;
      return n;
    })();
    const cats = [{ id: 'all', name: '全部分类', icon: 'grid' }].concat(D.CATEGORIES);
    return sheetShell('筛选', '按分类、地点与时间快速缩小范围', `
      <div class="filter-block">
        <div class="filter-label">物品分类</div>
        <div class="cat-choice-grid">
          ${cats.map((c) => `<button class="cat-choice ${d.category === c.id ? 'is-active' : ''}" data-action="filter-category" data-value="${c.id}">${icon(c.icon)}${c.name}</button>`).join('')}
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">地点 <span>按校园区域筛选</span></div>
        <div class="choice-row">
          ${[['all', '不限地点'], ['图书馆', '图书馆'], ['教学区', '教学区'], ['食堂', '食堂'], ['宿舍', '宿舍'], ['运动场', '运动场'], ['其他', '其他']].map(([v, label]) => `<button class="choice ${d.location === v ? 'is-active' : ''}" data-action="filter-choice" data-group="location" data-value="${v}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">发布时间</div>
        <div class="choice-row">
          ${[['all', '不限时间'], ['today', '今天'], ['3', '近三天'], ['7', '近一周'], ['30', '近一月']].map(([v, label]) => `<button class="choice ${d.time === v ? 'is-active' : ''}" data-action="filter-choice" data-group="time" data-value="${v}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">物品状态</div>
        <div class="choice-row">
          ${[['all', '全部状态'], ['active', '待认领'], ['returned', '已归还']].map(([v, label]) => `<button class="choice ${d.status === v ? 'is-active' : ''}" data-action="filter-choice" data-group="status" data-value="${v}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">排序方式</div>
        <div class="choice-row">
          ${[['newest', '最新发布'], ['oldest', '最早发布'], ['views', '最多浏览']].map(([v, label]) => `<button class="choice ${d.sort === v ? 'is-active' : ''}" data-action="filter-choice" data-group="sort" data-value="${v}">${label}</button>`).join('')}
        </div>
      </div>
    `, `<button class="btn btn--ghost" data-action="reset-filter">重置</button><button class="btn btn--primary" data-action="apply-filter">查看 ${resultCount} 条结果</button>`, { tall: true });
  }

  function contactSheet(itemId) {
    const item = itemById(itemId);
    if (!item) return sheetShell('联系发布者', '', emptyState({ title: '信息不存在', text: '该物品可能已被删除。' }));
    const owner = userById(item.ownerId);
    const contact = item.contact || {};
    const mine = item.ownerId === db.currentUserId;
    const claim = claimByMe(item.id);
    const approved = claim && (claim.status === 'approved' || claim.status === 'returned');
    const restricted = contact.locked === true || (item.contactVisibility === 'private' && !mine && !approved);
    const pending = claim && claim.status === 'pending' && restricted;
    const revealed = !!contact.unlocked || state.revealed.has(item.id) || approved || mine || (!apiMode && !db.settings.maskContact);
    const phone = contact.phone || owner.phone || '';
    const maskedPhone = contact.maskedPhone || maskPhone(owner.phone || '');
    const phoneText = restricted ? '认领通过后可见' : revealed ? phone : maskedPhone;
    const wechat = contact.wechat || (revealed ? owner.wechat || '' : '');
    const canReveal = !restricted && !revealed && contact.canReveal !== false;
    return sheetShell('联系发布者', restricted ? '对方设置了仅认领通过后可见' : '建议先核对物品特征，再约在校园公共区域见面', `
      <div class="contact-card">
        <div class="contact-person">
          ${avatar(owner)}
          <div class="contact-person-info"><strong>${esc(owner.name)}${owner.verified ? icon('verified') : ''}</strong><small>${esc(owner.college)} · ${esc(owner.grade)}</small></div>
        </div>
        <div class="contact-row">
          <span class="menu-icon menu-icon--blue">${icon('phone')}</span>
          <div class="contact-row-main"><span>联系电话</span><strong>${esc(phoneText)}</strong></div>
          ${canReveal ? `<button class="btn btn--soft btn--sm" data-action="reveal-phone" data-id="${esc(item.id)}">查看</button>` : ''}
          ${!restricted && revealed && phone && !phone.includes('*') ? `<a class="btn btn--ghost btn--sm" href="tel:${esc(phone)}" data-action="noop">${icon('phone')}呼叫</a>` : ''}
        </div>
        <div class="contact-row">
          <span class="menu-icon menu-icon--mint">${icon('wechat')}</span>
          <div class="contact-row-main"><span>微信号</span><strong>${esc(wechat || '认领通过后可见')}</strong></div>
          ${wechat ? `<button class="btn btn--ghost btn--sm" data-action="copy-wechat" data-text="${esc(wechat)}">${icon('copy')}复制</button>` : ''}
        </div>
        <div class="contact-mask">${icon('lock')}<span>${restricted ? (pending ? '你已提交认领申请，发布者确认后即可查看完整联系方式。' : '发布者选择仅认领通过后展示联系方式。你可以先提交认领核验。') : '手机号默认脱敏展示，请勿将联系方式转发给他人。'}</span></div>
      </div>
    `, restricted ? (pending
      ? `<button class="btn btn--primary btn--block" data-nav="my-claims">查看我的认领进度</button>`
      : `<button class="btn btn--primary btn--block" data-action="open-claim" data-id="${esc(item.id)}">先提交认领核验</button>`)
      : `<button class="btn btn--primary btn--block" data-action="close-sheet">我知道了</button>`);
  }

  function claimContactSheet(claimId) {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim) return sheetShell('联系对方', '', '');
    const user = userById(claim.claimantId);
    const contact = typeof claim.contact === 'string' ? { phone: claim.contact } : claim.contact || {};
    return sheetShell('联系认领人', '请当面核对物品特征并完成交接', `
      <div class="contact-person">
        ${avatar(user)}
        <div class="contact-person-info"><strong>${esc(user.name)} ${trustPill(user)}</strong><small>${esc(user.college)} · ${esc(user.grade)}</small></div>
      </div>
      <div class="contact-row"><span class="menu-icon menu-icon--blue">${icon('phone')}</span><div class="contact-row-main"><span>联系电话</span><strong>${esc(contact.phone || '通过后可见')}</strong></div>${contact.phone ? `<a class="btn btn--ghost btn--sm" href="tel:${esc(contact.phone)}" data-action="noop">${icon('phone')}呼叫</a>` : ''}</div>
      <div class="contact-row"><span class="menu-icon menu-icon--mint">${icon('wechat')}</span><div class="contact-row-main"><span>微信号</span><strong>${esc(contact.wechat || '未填写')}</strong></div>${contact.wechat ? `<button class="btn btn--ghost btn--sm" data-action="copy-wechat" data-text="${esc(contact.wechat)}">${icon('copy')}复制</button>` : ''}</div>
    `, `<button class="btn btn--primary btn--block" data-action="close-sheet">我知道了</button>`);
  }

  function openClaimContact(claimId) {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim) return;
    if (claim.contact) {
      openSheet('claim-contact', { claimId });
    } else {
      openContact(claim.itemId);
    }
  }

  function claimSheet(itemId) {
    const item = itemById(itemId);
    if (!item) return sheetShell('认领物品', '', emptyState({ title: '信息不存在', text: '该物品可能已被删除。' }));
    const questions = Array.isArray(item.questions) ? item.questions : [];
    const questionFields = questions
      .map(
        (q, index) => `<div class="field">
          <label class="field-label" for="claimAnswer${index}">核验题 ${index + 1}<em>*</em></label>
          <div class="question-prompt">${esc(q)}</div>
          <div class="input-wrap">${icon('shield')}<input id="claimAnswer${index}" data-claim-answer="${index}" maxlength="120" placeholder="请填写只有真正失主才知道的答案" autocomplete="off"></div>
        </div>`
      )
      .join('');
    return sheetShell('发起认领', questions.length ? `需回答 ${questions.length} 道防冒领核验题` : '描述只有真正失主才知道的细节，通过率更高', `
      <div class="claim-item-brief">
        <img src="${esc(item.images[0] || D.ITEM_IMAGES.fallback)}" alt="" onerror="this.src='${D.ITEM_IMAGES.fallback}'">
        <div><strong>${esc(item.title)}</strong><small>${esc(item.location)} · 发布于 ${relativeTime(item.createdAt)}</small></div>
      </div>
      ${questions.length ? questionFields : `<div class="field">
        <label class="field-label" for="claimAnswer">物品特征核验<em>*</em><span class="field-count" id="claimCount">0/120</span></label>
        <div class="textarea-wrap">
          <textarea class="textarea" id="claimAnswer" maxlength="120" placeholder="例如：卡套背面有一只蓝色小熊贴纸，卡号后四位是…"></textarea>
          <div class="textarea-foot"><span>至少 10 个字，请勿填写完整证件号</span></div>
        </div>
      </div>`}
      <div class="field">
        <label class="field-label" for="claimMessage">补充说明<span class="field-optional">选填</span></label>
        <div class="textarea-wrap">
          <textarea class="textarea" id="claimMessage" maxlength="200" placeholder="可以补充物品的其他特征、方便交接的时间等"></textarea>
        </div>
      </div>
      ${apiMode ? `<div class="safety-note">${icon('shield')}<span>核验答案只会在服务端比对，不会公开展示。发布者通过后，系统会生成一次性交接码；双方确认后才会归档为「已归还」。</span></div>` : `<div class="field">
        <label class="field-label" for="claimContact">你的联系电话<em>*</em></label>
        <div class="input-wrap">${icon('phone')}<input id="claimContact" type="tel" maxlength="11" value="${esc(me().phone)}" placeholder="方便发布者联系你"></div>
      </div>
      <div class="safety-note">${icon('shield')}<span>提交后，发布者会核对描述。请勿在描述中填写身份证号、银行卡号等敏感信息。</span></div>`}
      <div class="field-error hidden" id="claimError">${icon('alert')}<span></span></div>
    `, `<button class="btn btn--ghost" data-action="close-sheet">取消</button><button class="btn btn--primary" data-action="submit-claim" data-id="${esc(item.id)}">${icon('send')}提交认领</button>`, { auto: true });
  }

  function locationSheet() {
    const all = D.LOCATIONS;
    return sheetShell('选择地点', '选择物品丢失或拾获的校园位置', `
      <div class="location-search">${icon('search')}<input id="locationSearch" placeholder="搜索教学楼、食堂、馆舍…" autocomplete="off"></div>
      <div id="locationGroups">
        ${all.map((group) => `<div class="location-group" data-group="${esc(group.group)}">
          <h4>${esc(group.group)}</h4>
          <div class="location-list">
            ${group.places.map((p) => `<button class="location-choice ${state.form && state.form.location === p ? 'is-active' : ''}" data-action="choose-location" data-value="${esc(p)}">${esc(p)}</button>`).join('')}
          </div>
        </div>`).join('')}
      </div>
      <div class="field" style="margin-top:6px">
        <label class="field-label">没有找到？</label>
        <div class="input-wrap">${icon('location')}<input id="customLocation" placeholder="手动输入地点，例如「图书馆东侧楼梯」" value=""></div>
      </div>
    `, `<button class="btn btn--ghost" data-action="close-sheet">取消</button><button class="btn btn--primary" data-action="use-custom-location">使用该地点</button>`);
  }

  function claimsSheet(itemId) {
    const item = itemById(itemId);
    if (!item) return sheetShell('认领管理', '', '');
    const claims = claimsForItem(item.id);
    const pending = claims.filter((c) => c.status === 'pending');
    const done = claims.filter((c) => c.status !== 'pending');
    const body = claims.length
      ? `${pending.length ? `<div class="filter-label">待处理 <span>${pending.length} 条</span></div>${pending.map((c) => claimManageRow(c, item)).join('')}` : ''}
         ${done.length ? `<div class="filter-label" style="margin-top:16px">已处理 <span>${done.length} 条</span></div>${done.map((c) => claimManageRow(c, item)).join('')}` : ''}`
      : emptyState({ image: 'assets/empty-box.svg', title: '还没有认领申请', text: '当有人提交认领时，你可以在这里核对特征并决定是否通过。' });
    const foot = apiMode
      ? `<button class="btn btn--primary btn--block" data-action="close-sheet">完成</button>`
      : item.status === 'returned'
        ? ''
        : `<button class="btn btn--ghost" data-action="mark-returned" data-id="${esc(item.id)}">${icon('check-circle')}确认已归还</button><button class="btn btn--primary" data-action="close-sheet">完成</button>`;
    return sheetShell('认领管理', `${item.title} · ${claims.length} 条申请`, body, foot);
  }

  function claimManageRow(claim, item) {
    const cst = claimStatusInfo(claim.status);
    const user = userById(claim.claimantId);
    const contact = claim.contact && typeof claim.contact === 'object' ? claim.contact.phone : claim.contact;
    const contactText = claim.status === 'approved' || claim.status === 'returned' ? contact : maskPhone(contact || '');
    return `<div class="claim-card" style="margin-bottom:8px">
      <div class="claim-top">
        ${avatar(user)}
        <div class="claim-title"><h3>${esc(user.name)} ${trustPill(user)}</h3><p>${esc(user.college)} · ${relativeTime(claim.createdAt)}</p></div>
        <span class="manage-status manage-status--${cst.cls === 'pending' ? 'claimed' : cst.cls}">${cst.text}</span>
      </div>
      ${claim.matchCount !== undefined && claim.questionCount ? `<div class="claim-owner-line"><span class="pill-note">特征匹配 ${claim.matchCount}/${claim.questionCount}</span><span class="pill-note">${claim.questionCount} 道核验</span></div>` : ''}
      ${claimAnswerHTML(claim)}
      ${contactText ? `<div class="claim-note">联系电话：${esc(contactText)}</div>` : ''}
      ${handoverHTML(claim, true)}
      ${claim.status === 'pending'
        ? `<div class="claim-actions">
            <button class="btn btn--danger btn--sm" data-action="reject-claim" data-id="${esc(claim.id)}">不通过</button>
            <button class="btn btn--primary btn--sm" data-action="approve-claim" data-id="${esc(claim.id)}">${icon('check')}通过并生成交接码</button>
          </div>`
        : ''}
    </div>`;
  }

  function guideSheet() {
    return sheetShell('使用指南', '30 秒了解完整流程', `
      <div class="info-list" style="gap:14px">
        <div style="display:flex;gap:10px"><span class="step-num">1</span><div><strong style="display:block;color:#334156;font-size:11.5px">校园身份认证</strong><span style="font-size:9.5px;line-height:1.7;color:#7b879d">学号登录后，发布与认领都会带上认证标识，降低冒领风险。</span></div></div>
        <div style="display:flex;gap:10px"><span class="step-num">2</span><div><strong style="display:block;color:#334156;font-size:11.5px">发布寻物 / 招领</strong><span style="font-size:9.5px;line-height:1.7;color:#7b879d">上传照片、选择分类与校园地点，描述越具体越容易被匹配。</span></div></div>
        <div style="display:flex;gap:10px"><span class="step-num">3</span><div><strong style="display:block;color:#334156;font-size:11.5px">搜索与筛选</strong><span style="font-size:9.5px;line-height:1.7;color:#7b879d">按关键词、分类、地点、时间组合筛选；列表支持下滑加载更多。</span></div></div>
        <div style="display:flex;gap:10px"><span class="step-num">4</span><div><strong style="display:block;color:#334156;font-size:11.5px">防冒领认领</strong><span style="font-size:9.5px;line-height:1.7;color:#7b879d">发布时可设置最多 3 道只有真正物主才知道的核验题；答案只在服务端比对，不公开。</span></div></div>
        <div style="display:flex;gap:10px"><span class="step-num">5</span><div><strong style="display:block;color:#334156;font-size:11.5px">交接码双确认</strong><span style="font-size:9.5px;line-height:1.7;color:#7b879d">发布者通过后生成交接码，认领人当面输入，发布者再确认；双方都确认才归档为已归还。</span></div></div>
        <div style="display:flex;gap:10px"><span class="step-num">6</span><div><strong style="display:block;color:#334156;font-size:11.5px">信用与智能匹配</strong><span style="font-size:9.5px;line-height:1.7;color:#7b879d">成功归还积累信用分；系统还会按分类、地点和时间推荐可能相关的信息。</span></div></div>
      </div>
      <div class="safety-note" style="margin-top:14px">${icon('info')}<span>演示数据保存在浏览器 localStorage 中，可随时通过顶部「重置演示」恢复初始状态。</span></div>
    `, `<button class="btn btn--primary btn--block" data-action="close-sheet">开始体验</button>`);
  }

  function reportSheet(itemId) {
    const item = itemById(itemId);
    return sheetShell('举报信息', '我们会人工核查，必要时下架处理', `
      <div class="claim-item-brief"><img src="${esc(item ? item.images[0] : D.ITEM_IMAGES.fallback)}" alt=""><div><strong>${esc(item ? item.title : '')}</strong><small>选择举报原因</small></div></div>
      <div class="choice-row" style="margin-bottom:13px">
        ${['虚假信息', '冒领/诈骗', '联系方式错误', '内容不当'].map((r) => `<button class="choice ${state.reportReason === r ? 'is-active' : ''}" data-action="report-reason" data-value="${r}">${r}</button>`).join('')}
      </div>
      <div class="textarea-wrap"><textarea class="textarea" id="reportText" maxlength="120" placeholder="补充说明（选填）"></textarea></div>
    `, `<button class="btn btn--ghost" data-action="close-sheet">取消</button><button class="btn btn--primary" data-action="submit-report" data-id="${esc(itemId)}">提交举报</button>`);
  }

  function profileEditSheet() {
    const u = me();
    return sheetShell('编辑资料', '仅展示昵称、学院与简介', `
      <div class="field"><label class="field-label">昵称</label><div class="input-wrap">${icon('user')}<input id="editName" maxlength="12" value="${esc(u.name)}"></div></div>
      <div class="field"><label class="field-label">学院</label><div class="input-wrap">${icon('book')}<input id="editCollege" maxlength="20" value="${esc(u.college)}"></div></div>
      <div class="field"><label class="field-label">个人简介</label><div class="textarea-wrap"><textarea class="textarea" id="editBio" maxlength="50">${esc(u.bio || '')}</textarea></div></div>
      <div class="safety-note">${icon('lock')}<span>学号与认证状态不可在此修改，需通过校园统一身份认证更新。</span></div>
    `, `<button class="btn btn--ghost" data-action="close-sheet">取消</button><button class="btn btn--primary" data-action="save-profile">保存</button>`);
  }

  /* ============================== 对话框 ============================== */

  function openDialog(opts) {
    state.dialog = opts;
    renderDialog();
  }

  function closeDialog(silent) {
    state.dialog = null;
    if (modalRoot && !state.sheet) modalRoot.innerHTML = '';
    if (modalRoot && state.sheet) renderSheet();
    if (!silent) app.focus && app.focus();
  }

  function renderDialog() {
    if (!state.dialog || !modalRoot) return;
    const d = state.dialog;
    modalRoot.innerHTML = `<div class="dialog-layer" role="alertdialog" aria-modal="true" aria-label="${esc(d.title)}">
      <div class="dialog-backdrop" data-action="close-dialog"></div>
      <div class="dialog">
        <span class="dialog-icon ${d.tone === 'danger' ? 'dialog-icon--danger' : d.tone === 'mint' ? 'dialog-icon--mint' : ''}">${icon(d.icon || 'alert')}</span>
        <h2>${esc(d.title)}</h2>
        <p>${esc(d.body)}</p>
        ${d.list ? `<div class="dialog-list">${d.list.map((item, i) => `<button class="${i === 0 ? 'is-active' : ''}" data-action="dialog-choice" data-value="${esc(item.value || item.label)}">${icon(item.icon || 'chevron-right')}${esc(item.label)}</button>`).join('')}</div>` : ''}
        <div class="dialog-actions">
          <button class="btn btn--ghost" data-action="close-dialog">${esc(d.cancelText || '取消')}</button>
          <button class="btn ${d.tone === 'danger' ? 'btn--danger' : 'btn--primary'}" data-action="confirm-dialog">${esc(d.confirmText || '确认')}</button>
        </div>
      </div>
    </div>`;
  }

  /* ============================== 成功层 ============================== */

  function showSuccess(item, mode) {
    removeSuccess();
    const layer = document.createElement('div');
    layer.className = 'success-layer';
    const isEdit = mode === 'edit';
    layer.innerHTML = `
      <div class="success-mark">${icon('check')}</div>
      <h2>${isEdit ? '修改已保存' : '发布成功'}</h2>
      <p>${isEdit ? '信息已更新，感谢你让这条线索保持准确。' : '你的信息已经出现在首页。愿它尽快回到主人身边。'}</p>
      <div class="success-preview">
        <img src="${esc(item.images[0] || D.ITEM_IMAGES.fallback)}" alt="" onerror="this.src='${D.ITEM_IMAGES.fallback}'">
        <div><strong>${esc(item.title)}</strong><small>${esc(item.location)} · ${typeLabel(item.type)} · ${statusInfo(item).text}</small></div>
      </div>
      <div class="success-actions">
        <button class="btn btn--ghost" data-action="success-home">返回首页</button>
        <button class="btn btn--primary" data-action="success-detail" data-id="${esc(item.id)}">查看详情</button>
      </div>`;
    app.appendChild(layer);
  }

  function removeSuccess() {
    const el = app.querySelector('.success-layer');
    if (el) el.remove();
  }

  /* ============================== 渲染 ============================== */

  function render() {
    const route = state.route;
    if (route.name !== 'detail') state.lastViewedId = null;
    const protectedRoutes = ['profile', 'my-posts', 'my-claims', 'favorites', 'notifications', 'settings', 'security', 'feedback', 'publish'];
    if (!state.loggedIn && protectedRoutes.includes(route.name)) {
      state.route = { name: 'login' };
      history.replaceState(state.route, '', '#/login');
    }
    let html = '';
    switch (state.route.name) {
      case 'home':
        html = renderHome();
        break;
      case 'search':
        html = renderSearch();
        break;
      case 'detail':
        if (apiMode) {
          API.request('/api/items/' + encodeURIComponent(state.route.id))
            .then((data) => {
              const item = itemById(state.route.id);
              if (item && data.item) item.views = data.item.views;
            })
            .catch(() => {});
        } else {
          bumpViews(itemById(state.route.id));
        }
        html = renderDetail();
        break;
      case 'publish':
        html = renderPublish();
        break;
      case 'profile':
        html = renderProfile();
        break;
      case 'my-posts':
        html = renderMyPosts();
        break;
      case 'my-claims':
        html = renderMyClaims();
        break;
      case 'favorites':
        html = renderFavorites();
        break;
      case 'notifications':
        html = renderNotifications();
        break;
      case 'settings':
        html = renderSettings();
        break;
      case 'security':
        html = renderSecurity();
        break;
      case 'feedback':
        html = renderFeedback();
        break;
      case 'login':
        html = renderLogin();
        break;
      case 'about':
        html = renderAbout();
        break;
      default:
        html = renderHome();
    }
    app.innerHTML = html;
    app.scrollTop = 0;
    afterRender();
  }

  function afterRender() {
    const timeEls = $$('.js-time', app);
    timeEls.forEach((el) => (el.textContent = nowTime()));
    if (state.route.name === 'search') {
      const input = document.getElementById('searchInput');
      if (input) {
        input.focus();
        const len = input.value.length;
        try {
          input.setSelectionRange(len, len);
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (state.route.name === 'home') {
      initHomeScroll();
      initPullRefresh();
    }
    if (state.route.name === 'detail') {
      initGallery();
      loadMatches(itemById(state.route.id));
    }
    if (state.route.name === 'publish') {
      const scroller = app.querySelector('.view-scroll');
      if (scroller) scroller.scrollTop = 0;
    }
    const scroller = activeScroller();
    if (scroller) {
      const top = state.scrollPositions[scrollKey()] || 0;
      scroller.scrollTop = top;
      requestAnimationFrame(() => {
        scroller.scrollTop = top;
      });
    }
  }

  function initHomeScroll() {
    const sc = document.getElementById('homeScroll');
    if (!sc) return;
    let ticking = false;
    sc.addEventListener(
      'scroll',
      () => {
        state.scrollPositions[scrollKey()] = sc.scrollTop;
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 140) {
            loadMoreFeed();
          }
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  function loadMoreFeed() {
    const list = filteredFeed();
    if (state.feed.visible >= list.length) return;
    state.feed.visible += 4;
    const wrap = document.getElementById('feedList');
    if (wrap) wrap.innerHTML = list.slice(0, state.feed.visible).map((i) => itemCard(i)).join('');
    const footer = document.getElementById('feedFooter');
    if (footer) footer.innerHTML = feedFooterHTML(list.length);
  }

  function initPullRefresh() {
    const sc = document.getElementById('homeScroll');
    if (!sc) return;
    let startY = 0;
    let pulling = false;
    sc.addEventListener(
      'touchstart',
      (e) => {
        if (sc.scrollTop <= 0) {
          startY = e.touches[0].clientY;
          pulling = true;
        }
      },
      { passive: true }
    );
    sc.addEventListener(
      'touchend',
      (e) => {
        if (!pulling) return;
        const dy = e.changedTouches[0].clientY - startY;
        pulling = false;
        if (dy > 72) {
          if (apiMode) {
            syncFromApi(true).then((ok) => {
              if (!ok) return;
              state.feed.visible = 6;
              state.scrollPositions[scrollKey()] = 0;
              render();
              toast('已刷新最新信息');
            });
            return;
          }
          state.feed.visible = 6;
          state.scrollPositions[scrollKey()] = 0;
          render();
          toast('已刷新最新信息');
        }
      },
      { passive: true }
    );
  }

  function initGallery() {
    const gallery = document.getElementById('detailGallery');
    const dots = document.getElementById('detailDots');
    if (!gallery || !dots) return;
    gallery.addEventListener(
      'scroll',
      () => {
        const index = Math.round(gallery.scrollLeft / gallery.clientWidth);
        $$('i', dots).forEach((dot, i) => dot.classList.toggle('is-active', i === index));
      },
      { passive: true }
    );
  }

  /* ============================== 业务操作 ============================== */

  function toggleFavorite(id) {
    const item = itemById(id);
    if (!item) return;
    const wasFavorite = isFavorite(id);
    if (wasFavorite) {
      db.favorites = db.favorites.filter((x) => x !== id);
      toast('已取消收藏');
    } else {
      db.favorites.push(id);
      toast('已加入收藏');
    }
    saveOrWarn();
    if (state.route.name === 'detail' && state.route.id === id) {
      const filled = !wasFavorite;
      $$('[data-action="toggle-favorite"]', app).forEach((btn) => {
        if (btn.dataset.id !== id) return;
        btn.innerHTML = icon(filled ? 'heart-fill' : 'heart');
        btn.setAttribute('aria-label', filled ? '取消收藏' : '收藏');
      });
      return;
    }
    render();
  }

  function openContact(id) {
    const item = itemById(id);
    if (!item) return;
    if (!state.loggedIn) {
      navigate('login');
      return;
    }
    if (item.ownerId === db.currentUserId) {
      toast('这是你自己发布的信息');
      return;
    }
    openSheet('contact', { itemId: id });
  }

  function openClaim(id) {
    const item = itemById(id);
    if (!item) return;
    if (!state.loggedIn) {
      navigate('login');
      return;
    }
    if (item.ownerId === db.currentUserId) {
      toast('不能认领自己发布的物品', 'warn');
      return;
    }
    if (item.status === 'returned') {
      toast('该物品已归还', 'warn');
      return;
    }
    if (item.status === 'offline') {
      toast('该信息已下架', 'warn');
      return;
    }
    if (item.status === 'claimed') {
      toast('该物品已有认领人，暂不可重复认领', 'warn');
      return;
    }
    if (claimByMe(id)) {
      toast('你已经提交过认领，请在「我的认领」查看进度');
      return;
    }
    openSheet('claim', { itemId: id });
  }

  async function submitClaim(itemId) {
    const item = itemById(itemId);
    if (!item) return;
    if (db.claims.some((c) => c.itemId === itemId && c.claimantId === db.currentUserId && c.status === 'pending')) {
      toast('你已经有一条待审核的认领申请');
      return;
    }
    const errEl = document.getElementById('claimError');
    const answerInputs = $$('[data-claim-answer]');
    const answers = answerInputs.map((el) => el.value.trim());
    const messageEl = document.getElementById('claimMessage');
    const fallbackEl = document.getElementById('claimAnswer');
    const questions = Array.isArray(item.questions) ? item.questions : [];
    const messageText = questions.length
      ? (messageEl ? messageEl.value.trim() : '')
      : ((fallbackEl ? fallbackEl.value.trim() : '') || (messageEl ? messageEl.value.trim() : ''));
    let error = '';
    if (questions.length && answers.some((a) => a.length < 1)) error = '请回答全部核验题';
    if (!questions.length && !messageText) error = '请补充物品特征说明';
    if (!questions.length && messageText.length < 10) error = '请至少写 10 个字的物品特征';
    if (error) {
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.querySelector('span').textContent = error;
      }
      toast(error, 'warn');
      return;
    }
    const submitButton = document.querySelector('[data-action="submit-claim"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.innerHTML = '<span class="spinner"></span>提交中';
    }
    if (apiMode) {
      try {
        const result = await API.claim(itemId, { answers, message: messageText });
        await syncFromApi(false);
        closeSheet();
        const matched = result.claim ? `${result.claim.matchCount}/${result.claim.questionCount}` : '';
        toast(matched ? `认领已提交，特征匹配 ${matched}` : '认领申请已提交，等待对方确认');
        render();
      } catch (err) {
        apiError(err);
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = `${icon('send')}提交认领`;
        }
      }
      return;
    }
    const contactEl = document.getElementById('claimContact');
    const contact = normalizePhone(contactEl ? contactEl.value : me().phone);
    if (!/^1[3-9]\d{9}$/.test(contact)) {
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.querySelector('span').textContent = '请填写有效的 11 位联系电话';
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon('send')}提交认领`;
      }
      return;
    }
    const claim = {
      id: uid('cl'),
      itemId,
      claimantId: db.currentUserId,
      answer: questions.length ? answers.join('；') : messageText,
      answers: questions.map((q, i) => ({ q, a: answers[i], match: 0 })),
      contact,
      status: 'pending',
      createdAt: new Date().toISOString(),
      note: ''
    };
    db.claims.unshift(claim);
    db.notifications.unshift({
      id: uid('nt'),
      type: 'claim',
      title: '认领申请已提交',
      body: `你申请认领「${item.title}」，等待发布者核对特征。`,
      createdAt: new Date().toISOString(),
      read: false,
      itemId: item.id
    });
    saveOrWarn();
    closeSheet();
    toast('认领申请已提交，等待对方确认');
    render();
  }

  async function approveClaim(claimId) {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim) return;
    const item = itemById(claim.itemId);
    if (!item) return;
    if (apiMode) {
      try {
        const result = await API.approve(claimId);
        await syncFromApi(false);
        toast(`已通过认领${result.handoverCode ? '，交接码 ' + result.handoverCode : ''}`);
        render();
        if (state.sheet && state.sheet.type === 'claims') renderSheet();
      } catch (error) {
        apiError(error);
      }
      return;
    }
    claim.status = 'approved';
    claim.handoverCode = String(Math.floor(100000 + Math.random() * 900000));
    claim.claimantConfirmed = false;
    claim.ownerConfirmed = false;
    item.status = 'claimed';
    db.claims.forEach((c) => {
      if (c.itemId === item.id && c.id !== claim.id && c.status === 'pending') {
        c.status = 'rejected';
        c.note = '物品已由其他认领人确认';
      }
    });
    db.notifications.unshift({
      id: uid('nt'),
      type: 'claim',
      title: `已通过 ${userById(claim.claimantId).name} 的认领`,
      body: `「${item.title}」已标记为待交接，交接码 ${claim.handoverCode}。`,
      createdAt: new Date().toISOString(),
      read: false,
      itemId: item.id
    });
    saveOrWarn();
    toast('已通过认领，物品标记为待交接');
    render();
    if (state.sheet && state.sheet.type === 'claims') renderSheet();
  }

  async function rejectClaim(claimId) {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim) return;
    if (apiMode) {
      try {
        await API.reject(claimId);
        await syncFromApi(false);
        toast('已标记为未通过');
        render();
        if (state.sheet && state.sheet.type === 'claims') renderSheet();
      } catch (error) {
        apiError(error);
      }
      return;
    }
    claim.status = 'rejected';
    claim.note = '发布者未通过本次认领';
    const item = itemById(claim.itemId);
    db.notifications.unshift({
      id: uid('nt'),
      type: 'system',
      title: '认领申请未通过',
      body: `「${item ? item.title : '物品'}」的认领申请未通过，你可以补充更准确的特征后再次联系发布者。`,
      createdAt: new Date().toISOString(),
      read: false,
      itemId: item ? item.id : ''
    });
    saveOrWarn();
    toast('已标记为未通过');
    render();
    if (state.sheet && state.sheet.type === 'claims') renderSheet();
  }

  function markReturned(itemId) {
    const item = itemById(itemId);
    if (!item) return;
    item.status = 'returned';
    db.claims.forEach((c) => {
      if (c.itemId === item.id && (c.status === 'approved' || c.status === 'returned')) {
        c.status = 'returned';
        c.note = '物品已完成归还';
      }
    });
    db.notifications.unshift({
      id: uid('nt'),
      type: 'return',
      title: `「${item.title}」已归还`,
      body: '条目已归档，感谢你让物品回到了主人身边。',
      createdAt: new Date().toISOString(),
      read: false,
      itemId: item.id
    });
    saveOrWarn();
    closeSheet();
    toast('已标记为归还，条目已归档');
    render();
  }

  async function claimantConfirm(claimId) {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim) return;
    const input = document.getElementById('handoverCode');
    const code = input ? input.value.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      toast('请输入发布者提供的 6 位交接码', 'warn');
      return;
    }
    if (apiMode) {
      try {
        await API.claimantConfirm(claimId, code);
        await syncFromApi(false);
        toast('已确认收货，等待发布者确认交接');
        render();
        if (state.sheet && state.sheet.type === 'claims') renderSheet();
      } catch (error) {
        apiError(error);
      }
      return;
    }
    if (claim.handoverCode !== code) {
      toast('交接码不正确', 'warn');
      return;
    }
    claim.claimantConfirmed = true;
    saveOrWarn();
    toast('已确认收货，等待发布者确认交接');
    render();
    if (state.sheet && state.sheet.type === 'claims') renderSheet();
  }

  async function ownerConfirm(claimId) {
    const claim = db.claims.find((c) => c.id === claimId);
    if (!claim) return;
    if (apiMode) {
      try {
        await API.ownerConfirm(claimId);
        await syncFromApi(false);
        closeSheet();
        toast('交接已完成，物品已归档');
        render();
      } catch (error) {
        apiError(error);
      }
      return;
    }
    if (!claim.claimantConfirmed) {
      toast('请等待认领人输入交接码', 'warn');
      return;
    }
    markReturned(claim.itemId);
  }

  async function toggleItemStatus(itemId) {
    const item = itemById(itemId);
    if (!item) return;
    const nextStatus = item.status === 'offline' ? 'active' : 'offline';
    if (apiMode) {
      try {
        await API.updateItem(itemId, { status: nextStatus });
        await syncFromApi(false);
        toast(nextStatus === 'active' ? '已重新上架' : '已下架，信息不会再出现在首页');
        render();
      } catch (error) {
        apiError(error);
      }
      return;
    }
    item.status = nextStatus;
    toast(nextStatus === 'active' ? '已重新上架' : '已下架，信息不会再出现在首页');
    saveOrWarn();
    render();
  }

  async function deleteItem(itemId) {
    const item = itemById(itemId);
    if (!item) return;
    if (apiMode) {
      try {
        await API.deleteItem(itemId);
        await syncFromApi(false);
        toast('已下架该条信息');
        render();
      } catch (error) {
        apiError(error);
      }
      return;
    }
    db.items = db.items.filter((i) => i.id !== itemId);
    db.claims = db.claims.filter((c) => c.itemId !== itemId);
    db.favorites = db.favorites.filter((id) => id !== itemId);
    saveOrWarn();
    toast('已删除该条信息');
    render();
  }

  async function openNotification(id) {
    const n = db.notifications.find((x) => x.id === id);
    if (!n) return;
    n.read = true;
    if (apiMode) {
      try {
        await API.readNotifications(id);
      } catch (error) {
        /* 读消息失败不阻塞跳转 */
      }
    } else {
      saveOrWarn();
    }
    if (n.itemId && itemById(n.itemId)) {
      navigate('detail', { id: n.itemId });
    } else {
      render();
    }
  }

  async function login() {
    const idEl = document.getElementById('loginId');
    const passEl = document.getElementById('loginPass');
    const id = (idEl ? idEl.value : state.loginId).trim();
    const pass = passEl ? passEl.value : state.loginPass;
    state.loginId = id;
    state.loginPass = pass;
    if (!/^\d{8,12}$/.test(id)) {
      state.loginError = '请输入 8–12 位数字学号';
      render();
      return;
    }
    if (pass.length < 6) {
      state.loginError = '密码至少 6 位';
      render();
      return;
    }
    if (apiMode) {
      try {
        const result = await API.login(id, pass);
        API.setToken(result.token);
        const data = await API.bootstrap();
        applyBootstrap(data);
        state.loginError = '';
        state.loginPass = '';
        state.stack = [];
        navigate('home', {}, true);
        toast('校园身份认证成功');
      } catch (error) {
        state.loginError = error.message || '登录失败';
        render();
      }
      return;
    }
    state.loginError = '';
    state.loggedIn = true;
    state.loginPass = '';
    const existing = db.users.find((u) => u.studentId === id);
    if (existing) {
      db.currentUserId = existing.id;
    } else {
      const guest = {
        id: 'guest_' + id,
        studentId: id,
        name: '杭电同学',
        college: '未填写学院',
        grade: '—',
        verified: true,
        trustScore: 80,
        initial: '杭',
        tone: 'blue',
        bio: '本地演示访客账号',
        phone: '',
        wechat: ''
      };
      db.users.push(guest);
      db.currentUserId = guest.id;
    }
    saveOrWarn();
    state.stack = [];
    navigate('home', {}, true);
    toast('校园身份认证成功');
  }

  function logout() {
    openDialog({
      title: '退出登录？',
      body: '退出后需要重新通过校园身份认证才能发布与认领，本地演示数据不会被清除。',
      icon: 'logout',
      confirmText: '退出登录',
      tone: 'danger',
      onConfirm: 'logout'
    });
  }

  /* ============================== 事件 ============================== */

  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'noop') return;
      const handled = handleAction(action, actionEl, e);
      if (handled) e.preventDefault();
    }
    const navEl = e.target.closest('[data-nav]');
    if (navEl && !actionEl) {
      e.preventDefault();
      const target = navEl.dataset.nav;
      if (target === 'home' || target === 'profile') state.stack = [];
      navigate(target);
    }
  });

  function handleAction(action, el, event) {
    switch (action) {
      case 'back':
        goBack();
        return true;
      case 'go-home':
        navigate('home');
        return true;
      case 'open-item':
        navigate('detail', { id: el.dataset.id });
        return true;
      case 'open-publish':
        navigate('publish', { type: el.dataset.type || 'lost' });
        return true;
      case 'switch-publish-type':
        if (state.form) {
          state.form.type = el.dataset.type;
          state.form.errors = {};
        }
        render();
        return true;
      case 'set-feed-type':
        state.feed.type = el.dataset.type;
        state.feed.visible = 6;
        state.homeScrollTop = 0;
        render();
        return true;
      case 'set-feed-cat':
        state.feed.category = el.dataset.cat;
        state.feed.visible = 6;
        render();
        return true;
      case 'open-filter':
        openSheet('filter');
        return true;
      case 'filter-choice':
        if (state.filterDraft) state.filterDraft[el.dataset.group] = el.dataset.value;
        renderSheet();
        return true;
      case 'filter-category':
        if (state.filterDraft) state.filterDraft.category = el.dataset.value;
        renderSheet();
        return true;
      case 'reset-filter':
        state.filterDraft = { location: 'all', time: 'all', status: 'all', sort: 'newest', category: 'all' };
        renderSheet();
        return true;
      case 'apply-filter':
        if (state.filterDraft) {
          state.filters = {
            location: state.filterDraft.location || 'all',
            time: state.filterDraft.time || 'all',
            status: state.filterDraft.status || 'all',
            sort: state.filterDraft.sort || 'newest'
          };
          state.feed.category = state.filterDraft.category || 'all';
          state.feed.visible = 6;
          state.homeScrollTop = 0;
        }
        closeSheet();
        render();
        toast('筛选已应用');
        return true;
      case 'load-more':
        loadMoreFeed();
        return true;
      case 'clear-search':
        state.search.query = '';
        const input = document.getElementById('searchInput');
        if (input) {
          input.value = '';
          input.focus();
        }
        updateSearchResults();
        return true;
      case 'search-term':
        doSearchTerm(el.dataset.q);
        return true;
      case 'search-category':
        doSearchTerm(categoryById(el.dataset.cat).name);
        return true;
      case 'clear-history':
        db.searchHistory = [];
        saveOrWarn();
        render();
        toast('搜索历史已清空');
        return true;
      case 'toggle-favorite':
        toggleFavorite(el.dataset.id);
        return true;
      case 'share':
        shareCurrentItem();
        return true;
      case 'contact':
        openContact(el.dataset.id);
        return true;
      case 'contact-claim':
        openClaimContact(el.dataset.id);
        return true;
      case 'open-claim':
        closeSheet(true);
        openClaim(el.dataset.id);
        return true;
      case 'submit-claim':
        submitClaim(el.dataset.id);
        return true;
      case 'reveal-phone':
        if (apiMode) {
          API.contact(el.dataset.id)
            .then((data) => {
              const item = itemById(el.dataset.id);
              if (item) item.contact = { ...(item.contact || {}), ...data, unlocked: true };
              state.revealed.add(el.dataset.id);
              renderSheet();
            })
            .catch(apiError);
          return true;
        }
        state.revealed.add(el.dataset.id);
        renderSheet();
        return true;
      case 'copy-wechat':
        copyText(el.dataset.text);
        return true;
      case 'manage-claims':
        openSheet('claims', { itemId: el.dataset.id });
        return true;
      case 'approve-claim':
        approveClaim(el.dataset.id);
        return true;
      case 'reject-claim':
        rejectClaim(el.dataset.id);
        return true;
      case 'claimant-confirm':
        claimantConfirm(el.dataset.id);
        return true;
      case 'owner-confirm':
        ownerConfirm(el.dataset.id);
        return true;
      case 'mark-returned':
        markReturned(el.dataset.id);
        return true;
      case 'edit-item':
        navigate('publish', { type: itemById(el.dataset.id).type, id: el.dataset.id });
        return true;
      case 'toggle-item-status':
        toggleItemStatus(el.dataset.id);
        return true;
      case 'delete-item':
        openDialog({
          title: '删除这条信息？',
          body: '删除后，相关的认领记录也会一并移除，且无法恢复。',
          icon: 'trash',
          confirmText: '删除',
          tone: 'danger',
          onConfirm: 'delete-item',
          payload: el.dataset.id
        });
        return true;
      case 'open-location':
        openSheet('location');
        return true;
      case 'choose-location':
        if (state.form) {
          state.form.location = el.dataset.value;
          state.form.errors.location = '';
        }
        closeSheet();
        render();
        return true;
      case 'use-custom-location': {
        const custom = document.getElementById('customLocation');
        if (custom && custom.value.trim()) {
          state.form.location = custom.value.trim();
          state.form.errors.location = '';
          closeSheet();
          render();
        } else {
          toast('请先输入地点', 'warn');
        }
        return true;
      }
      case 'photo-add': {
        const input = document.getElementById('photoInput');
        if (input) input.click();
        return true;
      }
      case 'photo-remove':
        if (state.form) {
          state.form.images.splice(Number(el.dataset.index), 1);
          render();
        }
        return true;
      case 'choose-category':
        if (state.form) {
          state.form.category = el.dataset.cat;
          state.form.errors.category = '';
        }
        render();
        return true;
      case 'add-question':
        if (state.form) {
          if (!state.form.questions) state.form.questions = [];
          if (state.form.questions.length < 3) state.form.questions.push({ q: '', a: '' });
        }
        render();
        return true;
      case 'remove-question':
        if (state.form && state.form.questions) {
          state.form.questions.splice(Number(el.dataset.index), 1);
          if (!state.form.questions.length) state.form.questions.push({ q: '', a: '' });
        }
        render();
        return true;
      case 'set-contact-visibility':
        if (state.form) state.form.contactVisibility = el.dataset.value;
        render();
        return true;
      case 'toggle-agree':
        if (state.form) {
          state.form.agree = !state.form.agree;
          if (state.form.errors) state.form.errors.agree = '';
        }
        render();
        return true;
      case 'save-draft':
        saveDraft();
        return true;
      case 'restore-draft':
        restoreDraft(el.dataset.id);
        return true;
      case 'submit-publish':
        handleSubmitPublish(el);
        return true;
      case 'load-more-feed':
        loadMoreFeed();
        return true;
      case 'posts-tab':
        state.postsTab = el.dataset.tab;
        render();
        return true;
      case 'claims-tab':
        state.claimsTab = el.dataset.tab;
        render();
        return true;
      case 'open-notification':
        openNotification(el.dataset.id);
        return true;
      case 'mark-all-read':
        db.notifications.forEach((n) => (n.read = true));
        if (apiMode) {
          API.readNotifications().catch(() => {});
        } else {
          saveOrWarn();
        }
        render();
        toast('全部消息已标记为已读');
        return true;
      case 'toggle-setting': {
        const key = el.dataset.key;
        db.settings[key] = !db.settings[key];
        saveOrWarn();
        render();
        return true;
      }
      case 'reset-demo':
        openDialog({
          title: '重置演示数据？',
          body: '将清空本地新增的发布、认领和收藏，恢复到最初的 12 条示例信息。',
          icon: 'refresh',
          confirmText: '重置',
          tone: 'danger',
          onConfirm: 'reset-demo'
        });
        return true;
      case 'confirm-reset':
        resetDemo();
        return true;
      case 'logout':
        logout();
        return true;
      case 'change-password':
        toast('演示环境：请前往学校统一身份认证修改密码');
        return true;
      case 'logout-all':
        toast('已退出其他设备（演示）');
        return true;
      case 'feedback-category':
        state.feedbackCategory = el.dataset.value;
        render();
        return true;
      case 'submit-feedback':
        submitFeedback();
        return true;
      case 'close-sheet':
        closeSheet();
        return true;
      case 'close-dialog':
        closeDialog();
        return true;
      case 'confirm-dialog':
        runDialogConfirm();
        return true;
      case 'success-home':
        removeSuccess();
        state.feed = { type: 'all', category: 'all', visible: 6 };
        state.filters = { location: 'all', time: 'all', status: 'all', sort: 'newest' };
        state.homeScrollTop = 0;
        state.scrollPositions = {};
        state.stack = [];
        navigate('home');
        return true;
      case 'success-detail':
        removeSuccess();
        state.stack = [];
        navigate('detail', { id: el.dataset.id });
        return true;
      case 'open-guide':
        openSheet('guide');
        return true;
      case 'open-profile-edit':
        openSheet('profile-edit');
        return true;
      case 'save-profile':
        saveProfile();
        return true;
      case 'open-report':
        openSheet('report', { itemId: el.dataset.id });
        return true;
      case 'report-reason':
        state.reportReason = el.dataset.value;
        renderSheet();
        return true;
      case 'submit-report':
        submitReport(el.dataset.id);
        return true;
      case 'do-login':
        login();
        return true;
      case 'demo-login':
        state.loginId = '23034112';
        state.loginPass = 'hdu1956';
        state.loginError = '';
        if (document.getElementById('loginId')) document.getElementById('loginId').value = '23034112';
        if (document.getElementById('loginPass')) document.getElementById('loginPass').value = 'hdu1956';
        if (apiMode) {
          login();
          return true;
        }
        state.loggedIn = true;
        state.loginPass = '';
        state.stack = [];
        navigate('home', {}, true);
        toast('已使用演示账号进入');
        return true;
      case 'quick-login': {
        const user = db.users.find((u) => u.id === el.dataset.id);
        if (!user) return true;
        state.loginId = user.studentId;
        state.loginPass = 'hdu1956';
        state.loginError = '';
        if (document.getElementById('loginId')) document.getElementById('loginId').value = user.studentId;
        if (document.getElementById('loginPass')) document.getElementById('loginPass').value = 'hdu1956';
        login();
        return true;
      }
      case 'clear-data':
        resetDemo();
        return true;
      default:
        return false;
    }
  }

  function shareCurrentItem() {
    const item = itemById(state.route.id);
    if (!item) return;
    const url = location.href.split('#')[0] + routeHash({ name: 'detail', id: item.id });
    const data = { title: item.title, text: `杭电失物招领系统：${item.title}，${item.location}`, url };
    if (navigator.share) {
      navigator.share(data).catch(() => copyText(url));
    } else {
      copyText(url);
    }
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast('已复制到剪贴板'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('已复制到剪贴板');
    } catch (e) {
      toast('复制失败，请手动选择文本', 'warn');
    }
    ta.remove();
  }

  function saveDraft() {
    const f = state.form;
    if (!f) return;
    const existing = (db.drafts || []).find((d) => d.type === f.type);
    const id = f.draftId || (existing && existing.id) || uid('dr');
    f.draftId = id;
    const draft = {
      id,
      type: f.type,
      title: f.title,
      category: f.category,
      location: f.location,
      date: f.date,
      time: f.time,
      description: f.description,
      images: f.images.slice(),
      phone: f.phone,
      wechat: f.wechat,
      contactVisibility: f.contactVisibility,
      questions: (f.questions || []).map((q) => ({ q: q.q, a: q.a })),
      updatedAt: new Date().toISOString()
    };
    db.drafts = (db.drafts || []).filter((d) => d.id !== id);
    db.drafts.unshift(draft);
    saveOrWarn();
    toast('草稿已保存到本地');
  }

  function restoreDraft(id) {
    const draft = (db.drafts || []).find((d) => d.id === id);
    if (!draft) return;
    state.form = Object.assign(blankForm(draft.type), {
      id: null,
      mode: 'create',
      title: draft.title,
      category: draft.category,
      location: draft.location,
      date: draft.date,
      time: draft.time,
      description: draft.description,
      images: draft.images || [],
      phone: draft.phone,
      wechat: draft.wechat,
      contactVisibility: draft.contactVisibility || 'masked',
      questions: (draft.questions || []).map((q) => ({ q: q.q || '', a: q.a || '' })),
      draftRestored: true
    });
    render();
    toast('草稿已恢复');
  }

  function submitFeedback() {
    const textEl = document.getElementById('feedbackText');
    const text = textEl ? textEl.value.trim() : '';
    if (text.length < 5) {
      toast('请至少写 5 个字的建议', 'warn');
      return;
    }
    db.feedback.unshift({
      id: uid('fb'),
      category: state.feedbackCategory,
      text,
      createdAt: new Date().toISOString()
    });
    saveOrWarn();
    showFeedbackSuccess();
  }

  function showFeedbackSuccess() {
    removeSuccess();
    const layer = document.createElement('div');
    layer.className = 'success-layer';
    layer.innerHTML = `
      <div class="success-mark">${icon('check')}</div>
      <h2>感谢反馈!</h2>
      <p>你的建议已收到。杭电失物招领系统会继续打磨，让失物招领这件事更简单一点。</p>
      <div class="success-actions"><button class="btn btn--primary btn--block" data-action="close-success-feedback">返回</button></div>`;
    app.appendChild(layer);
    state.feedbackCategory = '功能建议';
  }

  async function saveProfile() {
    const name = (document.getElementById('editName') || {}).value || '';
    const college = (document.getElementById('editCollege') || {}).value || '';
    const bio = (document.getElementById('editBio') || {}).value || '';
    if (!name.trim()) {
      toast('昵称不能为空', 'warn');
      return;
    }
    if (apiMode) {
      try {
        await API.updateMe({ name: name.trim(), college: college.trim(), bio: bio.trim() });
        await syncFromApi(false);
        closeSheet();
        render();
        toast('资料已更新');
      } catch (error) {
        apiError(error);
      }
      return;
    }
    const u = me();
    u.name = name.trim();
    u.college = college.trim() || u.college;
    u.bio = bio.trim();
    u.initial = u.name.slice(0, 1);
    saveOrWarn();
    closeSheet();
    render();
    toast('资料已更新');
  }

  async function submitReport(itemId) {
    const reason = state.reportReason || '虚假信息';
    const item = itemById(itemId);
    const detail = (document.getElementById('reportText') || {}).value || '';
    if (apiMode) {
      try {
        await API.report({ itemId, reason, detail });
        closeSheet();
        toast('举报已提交，感谢你的反馈');
      } catch (error) {
        apiError(error);
      }
      return;
    }
    db.notifications.unshift({
      id: uid('nt'),
      type: 'system',
      title: '举报已收到',
      body: `我们已收到你对「${item ? item.title : '该信息'}」的反馈（${reason}），会在 24 小时内核查。`,
      createdAt: new Date().toISOString(),
      read: false,
      itemId: itemId
    });
    saveOrWarn();
    closeSheet();
    toast('举报已提交，感谢你的反馈');
  }

  function resetDemo() {
    if (apiMode) {
      toast('线上数据由服务器保存，不提供一键重置', 'warn');
      return;
    }
    db = D.reset();
    state.feed = { type: 'all', category: 'all', visible: 6 };
    state.filters = { location: 'all', time: 'all', status: 'all', sort: 'newest' };
    state.postsTab = 'all';
    state.claimsTab = 'mine';
    state.loggedIn = true;
    state.form = null;
    state.search.query = '';
    state.homeScrollTop = 0;
    state.scrollPositions = {};
    state.stack = [];
    closeSheet(true);
    closeDialog(true);
    removeSuccess();
    navigate('home', {}, true);
    toast('演示数据已重置');
  }

  function runDialogConfirm() {
    const d = state.dialog;
    if (!d) return;
    if (d.onConfirm === 'delete-item') {
      const id = d.payload;
      closeDialog(true);
      deleteItem(id);
      return;
    }
    if (d.onConfirm === 'reset-demo') {
      closeDialog(true);
      resetDemo();
      return;
    }
    if (d.onConfirm === 'logout') {
      closeDialog(true);
      if (apiMode && API) API.clearToken();
      state.loggedIn = false;
      db.currentUserId = null;
      state.loginPass = '';
      state.loginError = '';
      state.stack = [];
      state.scrollPositions = {};
      navigate('login', {}, true);
      toast('已退出登录');
      return;
    }
    if (typeof d.onConfirm === 'function') d.onConfirm();
    closeDialog();
  }

  /* 输入事件 */
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'searchInput') {
      state.search.query = el.value;
      updateSearchResults();
      return;
    }
    if (el.id === 'claimAnswer') {
      const count = document.getElementById('claimCount');
      if (count) count.textContent = `${el.value.length}/120`;
      return;
    }
    if (el.id === 'feedbackText') {
      const count = document.getElementById('feedbackCount');
      if (count) count.textContent = `${el.value.length}/200`;
      return;
    }
    if (el.id === 'locationSearch') {
      filterLocation(el.value);
      return;
    }
    if (el.matches('[data-question-q], [data-question-a]') && state.form) {
      const index = Number(el.dataset.questionQ ?? el.dataset.questionA);
      const key = el.dataset.questionQ !== undefined ? 'q' : 'a';
      if (state.form.questions && state.form.questions[index]) state.form.questions[index][key] = el.value;
      return;
    }
    if (el.matches('[data-form]') && state.form) {
      const key = el.dataset.form;
      state.form[key] = el.value;
      if (state.form.errors && state.form.errors[key]) {
        state.form.errors[key] = '';
        const field = el.closest('.field');
        if (field) {
          const err = field.querySelector('.field-error');
          if (err) err.remove();
          $$('.input-wrap--error, .textarea-wrap--error', field).forEach((node) => {
            node.classList.remove('input-wrap--error', 'textarea-wrap--error');
          });
        }
      }
      if (key === 'title') {
        const count = document.getElementById('titleCount');
        if (count) count.textContent = `${el.value.length}/30`;
      }
      if (key === 'description') {
        const count = document.getElementById('descCount');
        if (count) count.textContent = `${el.value.length}/300`;
      }
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'photoInput') {
      handlePhotoFiles(el.files);
      el.value = '';
    }
    if (el.matches('[data-form]') && state.form) {
      state.form[el.dataset.form] = el.value;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.dialog) closeDialog();
      else if (state.sheet) closeSheet();
    }
    if (e.key === 'Enter' && e.target.id === 'searchInput') {
      e.preventDefault();
      const q = e.target.value.trim();
      if (q) {
        const history = db.searchHistory || [];
        db.searchHistory = [q, ...history.filter((h) => h !== q)].slice(0, 8);
        saveOrWarn();
        updateSearchResults();
      }
    }
  });

  function filterLocation(query) {
    const q = String(query || '').trim().toLowerCase();
    $$('#locationGroups .location-group').forEach((group) => {
      let visible = 0;
      $$('.location-choice', group).forEach((btn) => {
        const show = !q || btn.textContent.toLowerCase().includes(q);
        btn.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      group.style.display = visible ? '' : 'none';
    });
  }

  function handlePhotoFiles(files) {
    if (!files || !files.length || !state.form) return;
    const remaining = 3 - state.form.images.length;
    if (remaining <= 0) {
      toast('最多上传 3 张照片', 'warn');
      return;
    }
    const list = Array.from(files).slice(0, remaining);
    let pending = list.length;
    list.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        pending--;
        return;
      }
      compressImage(file)
        .then((dataUrl) => {
          if (dataUrl) state.form.images.push(dataUrl);
        })
        .catch(() => toast('图片读取失败，请换一张试试', 'warn'))
        .finally(() => {
          pending--;
          if (pending === 0) {
            state.form.errors.images = '';
            render();
          }
        });
    });
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const max = 1000;
          let { width, height } = img;
          if (width > max || height > max) {
            const ratio = Math.min(max / width, max / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          try {
            resolve(canvas.toDataURL('image/jpeg', 0.78));
          } catch (err) {
            reject(err);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* 针对成功反馈层的关闭 */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="close-success-feedback"]');
    if (btn) {
      removeSuccess();
      render();
    }
  });

  /* 点击通知等外部 app 按钮（桌面顶部） */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-app-action]');
    if (!btn) return;
    const action = btn.dataset.appAction;
    if (action === 'open-guide') openSheet('guide');
    if (action === 'reset-demo') {
      openDialog({
        title: '重置演示数据？',
        body: '将清空本地新增的发布、认领和收藏，恢复到最初的 12 条示例信息。',
        icon: 'refresh',
        confirmText: '重置',
        tone: 'danger',
        onConfirm: 'reset-demo'
      });
    }
  });

  /* 桌面顶部按钮在 app 外，需把 modal-root 打开；这里 modal-root 在手机内，用户仍能看到。 */

  /* 初始化 */
  function boot() {
    const route = parseHash();
    state.route = route;
    if (route.name === 'publish') preparePublish(route);
    if (!db.settings) db.settings = { notifyNew: true, notifyClaim: true, maskContact: true, haptic: true };
    if (!db.searchHistory) db.searchHistory = [];
    if (!db.favorites) db.favorites = [];
    if (!db.drafts) db.drafts = [];
    if (!db.feedback) db.feedback = [];
    render();
    setTimeout(() => {
      if (toastRoot) toastRoot.innerHTML = '';
    }, 1200);
    setInterval(() => {
      $$('.js-time', app).forEach((el) => (el.textContent = nowTime()));
    }, 30000);

    (async () => {
      if (!API) return;
      const available = await API.probe();
      if (!available) return;
      state.apiMode = true;
      apiMode = true;
      try {
        let data;
        try {
          data = await API.bootstrap();
        } catch (error) {
          if (error.status === 401) {
            API.clearToken();
            data = await API.bootstrap();
          } else {
            throw error;
          }
        }
        applyBootstrap(data);
        apiReady = true;
        render();
      } catch (error) {
        state.apiMode = false;
        apiMode = false;
        apiReady = false;
        toast('后端暂时不可用，已切换到本地演示模式', 'warn');
      }
    })();
  }

  boot();
})();


