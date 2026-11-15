'use strict';

/*
 * 杭电失物招领系统 · 轻量后端
 * 依赖：Node.js >= 24（内置 node:sqlite / fetch / crypto），无第三方依赖。
 * 启动：node server.js    默认 http://localhost:3000
 *
 * 安全约定：
 * - 核验题答案只在服务端比较，公开接口只返回题目文本与匹配数量；
 * - 联系方式默认只返回脱敏值，完整号码需登录并满足认领状态；
 * - 交接码只返回给物品发布者，认领人必须在线下拿到后输入确认；
 * - 所有写操作使用参数化 SQL，不把用户输入拼进 SQL。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./server/seed');

const ROOT = __dirname;

function loadEnvFile() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* 没有 .env 时忽略 */
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, '.data');
const DB_FILE = path.join(DATA_DIR, 'hdu.sqlite');
const SECRET_PLACEHOLDER = 'replace-with-a-long-random-secret';
const CONFIGURED_SECRET =
  process.env.AUTH_SECRET && process.env.AUTH_SECRET !== SECRET_PLACEHOLDER ? process.env.AUTH_SECRET : '';
const AUTH_SECRET = CONFIGURED_SECRET || crypto.randomBytes(32).toString('hex');
if (!CONFIGURED_SECRET) {
  console.warn('[hdu-lost-found] AUTH_SECRET 未设置或仍是示例值，已使用临时随机密钥；重启后登录状态会失效。');
}
const TOKEN_TTL = 7 * 24 * 3600 * 1000;
const BODY_LIMIT = 8 * 1024 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CATEGORIES = new Set(['card', 'key', 'tech', 'book', 'umbrella', 'other']);
const STATUSES = new Set(['active', 'claimed', 'returned', 'offline']);

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, student_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    college TEXT, grade TEXT, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1, trust_score INTEGER NOT NULL DEFAULT 80,
    initial TEXT, tone TEXT, bio TEXT, phone TEXT, wechat TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
    location TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
    description TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
    owner_id TEXT NOT NULL REFERENCES users(id), views INTEGER NOT NULL DEFAULT 0,
    urgent INTEGER NOT NULL DEFAULT 0, contact_visibility TEXT NOT NULL DEFAULT 'masked',
    contact_phone TEXT, contact_wechat TEXT, highlights TEXT NOT NULL DEFAULT '[]',
    questions TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), claimant_id TEXT NOT NULL REFERENCES users(id),
    owner_id TEXT NOT NULL REFERENCES users(id), message TEXT, answers TEXT NOT NULL DEFAULT '[]',
    match_count INTEGER NOT NULL DEFAULT 0, question_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', handover_code TEXT, claimant_confirmed INTEGER NOT NULL DEFAULT 0,
    owner_confirmed INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, item_id TEXT, claim_id TEXT,
    read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL, reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner_id);
  CREATE INDEX IF NOT EXISTS idx_claims_item ON claims(item_id);
  CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(claimant_id, status);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
`);

/* ------------------------------ 通用工具 ------------------------------ */

const nowIso = () => new Date().toISOString();
const json = (res, code, data, extra = {}) => {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extra
  });
  res.end(body);
};
const fail = (res, code, message) => json(res, code, { error: message });
const maskPhone = (phone) => {
  const p = String(phone || '');
  return p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : p;
};
const clean = (value, min = 1, max = 500) => {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length >= min && s.length <= max ? s : null;
};
const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s，。,.!！?？、:：;；'"“”‘’（）()【】[\]\-_/\\]/g, '');
const answerMatch = (correct, given) => {
  const g = normalize(given);
  if (!g) return false;
  return String(correct || '')
    .split('|')
    .map(normalize)
    .some((c) => c.length >= 2 && (g === c || g.includes(c)));
};
const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/* ------------------------------ 数据访问 ------------------------------ */

const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const itemById = (id) => db.prepare('SELECT * FROM items WHERE id = ?').get(id);
const claimById = (id) => db.prepare('SELECT * FROM claims WHERE id = ?').get(id);

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    studentId: row.student_id,
    college: row.college,
    grade: row.grade,
    verified: !!row.verified,
    trustScore: row.trust_score,
    initial: row.initial,
    tone: row.tone,
    bio: row.bio
  };
}

function meUser(row) {
  return { ...publicUser(row), phone: row.phone, wechat: row.wechat };
}

function addNotification(userId, type, title, body, itemId, claimId) {
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, item_id, claim_id, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
  ).run('nt_' + crypto.randomBytes(6).toString('hex'), userId, type, title, body, itemId || '', claimId || '', nowIso());
}

function approvedClaimFor(itemId, viewerId) {
  if (!viewerId) return null;
  return db
    .prepare("SELECT * FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ('approved','returned') LIMIT 1")
    .get(itemId, viewerId);
}

function itemDTO(row, viewer) {
  const owner = userById(row.owner_id);
  const isOwner = !!viewer && viewer.id === row.owner_id;
  const approved = approvedClaimFor(row.id, viewer && viewer.id);
  const unlocked = isOwner || !!approved;
  const canReveal = !!viewer && (unlocked || row.contact_visibility === 'masked');
  const questions = parseJson(row.questions, []);
  const claims = db.prepare('SELECT COUNT(*) AS n FROM claims WHERE item_id = ?').get(row.id).n;
  const pending = isOwner
    ? db.prepare("SELECT COUNT(*) AS n FROM claims WHERE item_id = ? AND status = 'pending'").get(row.id).n
    : 0;
  const contact = unlocked
    ? { unlocked: true, phone: row.contact_phone, wechat: row.contact_wechat, maskedPhone: maskPhone(row.contact_phone) }
    : row.contact_visibility === 'private'
      ? { unlocked: false, phone: null, wechat: null, maskedPhone: null, canReveal: false }
      : { unlocked: false, phone: maskPhone(row.contact_phone), wechat: null, maskedPhone: maskPhone(row.contact_phone), canReveal };

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    category: row.category,
    location: row.location,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    description: row.description,
    images: parseJson(row.images, []),
    status: row.status,
    ownerId: row.owner_id,
    views: row.views,
    urgent: !!row.urgent,
    contactVisibility: row.contact_visibility,
    highlights: parseJson(row.highlights, []),
    questions: questions.map((q) => q.q),
    questionCount: questions.length,
    questionDetails: isOwner ? questions : undefined,
    owner: publicUser(owner),
    contact,
    isOwner,
    claimCount: claims,
    pendingClaims: pending,
    myClaim: viewer
      ? (() => {
          const c = db
            .prepare("SELECT id, status FROM claims WHERE item_id = ? AND claimant_id = ? ORDER BY created_at DESC LIMIT 1")
            .get(row.id, viewer.id);
          return c ? { id: c.id, status: c.status } : null;
        })()
      : null
  };
}

function claimDTO(row, viewer) {
  const item = itemById(row.item_id);
  const claimant = userById(row.claimant_id);
  const owner = userById(row.owner_id);
  const isOwner = viewer && viewer.id === row.owner_id;
  const isClaimant = viewer && viewer.id === row.claimant_id;
  const canSeeAnswers = isOwner || isClaimant;
  const approved = row.status === 'approved' || row.status === 'returned';

  return {
    id: row.id,
    itemId: row.item_id,
    claimantId: row.claimant_id,
    ownerId: row.owner_id,
    status: row.status,
    message: row.message || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    matchCount: row.match_count,
    questionCount: row.question_count,
    answers: canSeeAnswers ? parseJson(row.answers, []) : [],
    claimant: publicUser(claimant),
    owner: publicUser(owner),
    contact: isOwner && approved ? { phone: claimant.phone, wechat: claimant.wechat } : null,
    handoverCode: isOwner && row.status === 'approved' ? row.handover_code : null,
    claimantConfirmed: !!row.claimant_confirmed,
    ownerConfirmed: !!row.owner_confirmed,
    canConfirm: isClaimant && row.status === 'approved' && !row.claimant_confirmed,
    canOwnerConfirm: isOwner && row.status === 'approved' && !!row.claimant_confirmed && !row.owner_confirmed,
    item: item ? { id: item.id, title: item.title, images: parseJson(item.images, []) } : null
  };
}

/* ------------------------------ 认证 ------------------------------ */

const passwordHash = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');
const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
const sign = (userId) => {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
};
const verifyToken = (token) => {
  try {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
    if (!safeEqual(sig, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || !data.exp || data.exp < Date.now()) return null;
    return userById(data.uid);
  } catch {
    return null;
  }
};
const authUser = (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token ? verifyToken(token) : null;
};
const requireUser = (req, res) => {
  const user = authUser(req);
  if (!user) {
    fail(res, 401, '请先登录');
    return null;
  }
  return user;
};

/* ------------------------------ 限流 ------------------------------ */

const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
const clientIp = (req) => req.socket.remoteAddress || 'unknown';

/* ------------------------------ 请求体 ------------------------------ */

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('JSON 格式不正确'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------ 种子 ------------------------------ */

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count) return;
  db.exec('BEGIN');
  try {
    const insertUser = db.prepare(
      'INSERT INTO users (id, student_id, name, college, grade, password_salt, password_hash, verified, trust_score, initial, tone, bio, phone, wechat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const u of seed.users) {
      const salt = crypto.randomBytes(16).toString('hex');
      insertUser.run(
        u.id, u.studentId, u.name, u.college, u.grade, salt, passwordHash(seed.PASSWORD, salt),
        u.verified ? 1 : 0, u.trustScore || 80, u.initial || u.name.slice(0, 1), u.tone || 'blue',
        u.bio || '', u.phone || '', u.wechat || '', nowIso()
      );
    }
    const insertItem = db.prepare(
      'INSERT INTO items (id, type, title, category, location, occurred_at, created_at, description, images, status, owner_id, views, urgent, contact_visibility, contact_phone, contact_wechat, highlights, questions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const i of seed.items) {
      insertItem.run(
        i.id, i.type, i.title, i.category, i.location, i.occurredAt, i.createdAt, i.description,
        JSON.stringify(i.images || []), i.status || 'active', i.ownerId, i.views || 0, i.urgent ? 1 : 0,
        i.contactVisibility || 'masked', i.contactPhone || '', i.contactWechat || '',
        JSON.stringify(i.highlights || []), JSON.stringify(i.questions || [])
      );
    }
    const insertClaim = db.prepare(
      'INSERT INTO claims (id, item_id, claimant_id, owner_id, message, answers, match_count, question_count, status, handover_code, claimant_confirmed, owner_confirmed, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of seed.claims) {
      insertClaim.run(
        c.id, c.itemId, c.claimantId, c.ownerId || itemById(c.itemId).owner_id, c.message || c.answer || '',
        JSON.stringify(c.answers || []), c.matchCount || 0, c.questionCount || 0, c.status || 'pending',
        c.handoverCode || '', c.claimantConfirmed || 0, c.ownerConfirmed || 0, c.note || '', c.createdAt, c.createdAt
      );
    }
    const insertNotification = db.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, item_id, claim_id, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const n of seed.notifications) {
      insertNotification.run(n.id, n.userId || 'u1', n.type, n.title, n.body, n.itemId || '', '', n.read ? 1 : 0, n.createdAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
seedDatabase();

/* ------------------------------ 业务逻辑 ------------------------------ */

function validateItem(body, existing) {
  const source = { ...(existing || {}), ...body };
  const type = source.type === 'found' ? 'found' : source.type === 'lost' ? 'lost' : null;
  const title = clean(source.title, 4, 40);
  const category = CATEGORIES.has(source.category) ? source.category : null;
  const location = clean(source.location, 2, 50);
  const occurredAt = new Date(source.occurredAt);
  const description = clean(source.description, 10, 400);
  const contactVisibility = source.contactVisibility === 'private' ? 'private' : 'masked';
  const phone = String(source.phone || '').replace(/\D/g, '');
  const wechat = clean(source.wechat || '', 0, 30) ?? '';
  const images = Array.isArray(source.images) ? source.images.slice(0, 3) : [];
  const questions = Array.isArray(source.questions) ? source.questions.slice(0, 3) : [];
  if (!type) return { error: '请选择寻物或招领' };
  if (!title) return { error: '物品名称需为 4–40 个字' };
  if (!category) return { error: '请选择物品分类' };
  if (!location) return { error: '地点需为 2–50 个字' };
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return { error: '发生时间不能晚于现在' };
  }
  if (!description) return { error: '特征描述需为 10–400 个字' };
  if (!/^1[3-9]\d{9}$/.test(phone)) return { error: '请填写有效的 11 位手机号' };
  if (!images.length || images.some((x) => typeof x !== 'string' || x.length > 400000)) {
    return { error: '请上传 1–3 张图片，单张不要超过 300KB' };
  }
  const qs = [];
  for (const item of questions) {
    const q = clean(item && item.q, 2, 80);
    const a = clean(item && item.a, 2, 80);
    if (!q || !a) return { error: '核验题和答案都不能为空' };
    qs.push({ q, a });
  }
  return {
    value: {
      type,
      title,
      category,
      location,
      occurredAt: occurredAt.toISOString(),
      description,
      contactVisibility,
      phone,
      wechat,
      images,
      questions: qs
    }
  };
}

function completeHandover(claim) {
  const item = itemById(claim.item_id);
  if (!item || claim.status !== 'approved') return;
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE claims SET status = 'returned', owner_confirmed = 1, updated_at = ? WHERE id = ?").run(nowIso(), claim.id);
    db.prepare("UPDATE items SET status = 'returned' WHERE id = ?").run(item.id);
    db.prepare('UPDATE users SET trust_score = MIN(100, trust_score + 5) WHERE id IN (?, ?)').run(claim.owner_id, claim.claimant_id);
    addNotification(claim.owner_id, 'return', '物品已归还', `「${item.title}」完成双确认交接，已归档。`, item.id, claim.id);
    addNotification(claim.claimant_id, 'return', '交接已完成', `你认领的「${item.title}」已完成交接，感谢你让物品回家。`, item.id, claim.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function matchesFor(item, viewer) {
  const opposite = item.type === 'lost' ? 'found' : 'lost';
  const rows = db
    .prepare("SELECT * FROM items WHERE type = ? AND status = 'active' AND id <> ? ORDER BY created_at DESC LIMIT 80")
    .all(opposite, item.id);
  const places = ['图书馆', '一教', '二教', '三教', '四教', '六教', '七教', '食堂', '宿舍', '体育馆', '田径场', '篮球场', '游泳馆', '东门', '南门', '行政楼', '服务中心'];
  const baseTime = new Date(item.occurred_at).getTime();
  return rows
    .map((candidate) => {
      const reasons = [];
      let score = 0;
      if (candidate.category === item.category) {
        score += 45;
        reasons.push('同分类');
      }
      const sharedPlace = places.find((p) => item.location.includes(p) && candidate.location.includes(p));
      if (sharedPlace) {
        score += 25;
        reasons.push('同区域');
      }
      const days = Math.abs(new Date(candidate.occurred_at).getTime() - baseTime) / 864e5;
      if (days <= 3) {
        score += 20;
        reasons.push('时间接近');
      } else if (days <= 14) {
        score += 10;
        reasons.push('时间相近');
      }
      if (candidate.contact_visibility === 'private') score += 5;
      return { row: candidate, score, reasons };
    })
    .filter((x) => x.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => ({ ...itemDTO(x.row, viewer), matchScore: x.score, matchReasons: x.reasons }));
}

/* ------------------------------ API 路由 ------------------------------ */

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/api/health' && method === 'GET') {
    json(res, 200, { ok: true, service: 'hdu-lost-found', time: nowIso() });
    return true;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!rateLimit('login:' + clientIp(req), 20, 10 * 60 * 1000)) return fail(res, 429, '尝试次数过多，请稍后再试'), true;
    const body = await readJson(req);
    const studentId = String(body.studentId || '').trim();
    const password = String(body.password || '');
    if (!/^\d{8,12}$/.test(studentId) || password.length < 6) return fail(res, 400, '学号或密码格式不正确'), true;
    const user = db.prepare('SELECT * FROM users WHERE student_id = ?').get(studentId);
    if (!user || !safeEqual(passwordHash(password, user.password_salt), user.password_hash)) {
      return fail(res, 401, '学号或密码不正确'), true;
    }
    json(res, 200, { token: sign(user.id), user: meUser(user), expiresIn: TOKEN_TTL });
    return true;
  }

  if (pathname === '/api/bootstrap' && method === 'GET') {
    const viewer = authUser(req);
    const users = db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser);
    let items;
    if (viewer) {
      items = db
        .prepare(
          "SELECT * FROM items WHERE status <> 'offline' OR owner_id = ? OR id IN (SELECT item_id FROM claims WHERE claimant_id = ?) ORDER BY created_at DESC"
        )
        .all(viewer.id, viewer.id);
    } else {
      items = db.prepare("SELECT * FROM items WHERE status <> 'offline' ORDER BY created_at DESC").all();
    }
    const claims = viewer
      ? db
          .prepare('SELECT * FROM claims WHERE claimant_id = ? OR owner_id = ? ORDER BY created_at DESC LIMIT 100')
          .all(viewer.id, viewer.id)
      : [];
    const notifications = viewer
      ? db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60').all(viewer.id)
      : [];
    json(res, 200, {
      user: viewer ? meUser(viewer) : null,
      users,
      items: items.map((i) => itemDTO(i, viewer)),
      claims: claims.map((c) => claimDTO(c, viewer)),
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        createdAt: n.created_at,
        read: !!n.read,
        itemId: n.item_id,
        claimId: n.claim_id
      })),
      serverTime: nowIso()
    });
    return true;
  }

  if (pathname === '/api/me' && method === 'PATCH') {
    const user = requireUser(req, res);
    if (!user) return true;
    const body = await readJson(req);
    const name = clean(body.name, 1, 12);
    const college = clean(body.college, 2, 20);
    const bio = clean(body.bio || '', 0, 60);
    const phone = String(body.phone || user.phone || '').replace(/\D/g, '');
    const wechat = clean(body.wechat || '', 0, 30);
    if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    if (college) db.prepare('UPDATE users SET college = ? WHERE id = ?').run(college, user.id);
    if (bio !== null) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, user.id);
    if (/^1[3-9]\d{9}$/.test(phone)) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, user.id);
    if (wechat !== null) db.prepare('UPDATE users SET wechat = ? WHERE id = ?').run(wechat, user.id);
    json(res, 200, { user: meUser(userById(user.id)) });
    return true;
  }

  if (pathname === '/api/items' && method === 'GET') {
    const viewer = authUser(req);
    const q = clean(url.searchParams.get('q') || '', 0, 60) || '';
    const type = url.searchParams.get('type');
    const category = url.searchParams.get('category');
    let rows = db.prepare("SELECT * FROM items WHERE status <> 'offline' ORDER BY created_at DESC LIMIT 100").all();
    if (type === 'lost' || type === 'found') rows = rows.filter((r) => r.type === type);
    if (CATEGORIES.has(category)) rows = rows.filter((r) => r.category === category);
    if (q) rows = rows.filter((r) => [r.title, r.description, r.location].join(' ').includes(q));
    json(res, 200, { items: rows.map((r) => itemDTO(r, viewer)) });
    return true;
  }

  if (pathname === '/api/items' && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return true;
    if (!rateLimit('create:' + user.id, 20, 60 * 60 * 1000)) return fail(res, 429, '发布过于频繁'), true;
    const body = await readJson(req);
    const validation = validateItem(body);
    if (validation.error) return fail(res, 400, validation.error), true;
    const v = validation.value;
    const id = 'it_' + crypto.randomBytes(6).toString('hex');
    db.prepare(
      'INSERT INTO items (id, type, title, category, location, occurred_at, created_at, description, images, status, owner_id, views, urgent, contact_visibility, contact_phone, contact_wechat, highlights, questions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)'
    ).run(
      id, v.type, v.title, v.category, v.location, v.occurredAt, nowIso(), v.description,
      JSON.stringify(v.images), 'active', user.id, v.contactVisibility, v.phone, v.wechat, '[]', JSON.stringify(v.questions)
    );
    const created = itemById(id);
    json(res, 201, { item: itemDTO(created, user), matches: matchesFor(created, user) });
    return true;
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)(?:\/(matches|contact))?$/);
  if (itemMatch) {
    const item = itemById(itemMatch[1]);
    if (!item) return fail(res, 404, '物品不存在'), true;
    const action = itemMatch[2];
    if (!action && method === 'GET') {
      db.prepare('UPDATE items SET views = views + 1 WHERE id = ?').run(item.id);
      json(res, 200, { item: itemDTO(itemById(item.id), authUser(req)) });
      return true;
    }
    if (action === 'matches' && method === 'GET') {
      json(res, 200, { matches: matchesFor(item, authUser(req)) });
      return true;
    }
    if (action === 'contact' && method === 'GET') {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!rateLimit('contact:' + user.id, 60, 60 * 60 * 1000)) return fail(res, 429, '操作过于频繁'), true;
      const owner = item.owner_id === user.id;
      const approved = approvedClaimFor(item.id, user.id);
      if (!owner && !approved && item.contact_visibility === 'private') {
        return fail(res, 403, '该发布者设置了仅认领通过后可见'), true;
      }
      json(res, 200, { phone: item.contact_phone, wechat: item.contact_wechat });
      return true;
    }
    if (!action && method === 'PATCH') {
      const user = requireUser(req, res);
      if (!user) return true;
      if (item.owner_id !== user.id) return fail(res, 403, '无权修改该信息'), true;
      const body = await readJson(req);
      if (body.status === 'offline' || body.status === 'active') {
        db.prepare('UPDATE items SET status = ? WHERE id = ?').run(body.status, item.id);
        return json(res, 200, { item: itemDTO(itemById(item.id), user) }), true;
      }
      const validation = validateItem(body, item);
      if (validation.error) return fail(res, 400, validation.error), true;
      const v = validation.value;
      db.prepare(
        'UPDATE items SET type=?, title=?, category=?, location=?, occurred_at=?, description=?, images=?, contact_visibility=?, contact_phone=?, contact_wechat=?, questions=? WHERE id=?'
      ).run(
        v.type, v.title, v.category, v.location, v.occurredAt, v.description, JSON.stringify(v.images),
        v.contactVisibility, v.phone, v.wechat, JSON.stringify(v.questions), item.id
      );
      json(res, 200, { item: itemDTO(itemById(item.id), user) });
      return true;
    }
    if (!action && method === 'DELETE') {
      const user = requireUser(req, res);
      if (!user) return true;
      if (item.owner_id !== user.id) return fail(res, 403, '无权下架该信息'), true;
      db.prepare("UPDATE items SET status = 'offline' WHERE id = ?").run(item.id);
      json(res, 200, { ok: true });
      return true;
    }
  }

  const claimPost = pathname.match(/^\/api\/items\/([^/]+)\/claims$/);
  if (claimPost && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return true;
    const item = itemById(claimPost[1]);
    if (!item) return fail(res, 404, '物品不存在'), true;
    if (item.owner_id === user.id) return fail(res, 403, '不能认领自己发布的物品'), true;
    if (item.status !== 'active') return fail(res, 409, '该物品当前不可认领'), true;
    if (!rateLimit('claim:' + user.id, 10, 60 * 60 * 1000)) return fail(res, 429, '认领操作过于频繁'), true;
    const exists = db
      .prepare("SELECT 1 FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ('pending','approved','returned') LIMIT 1")
      .get(item.id, user.id);
    if (exists) return fail(res, 409, '你已经提交过该物品的认领'), true;
    const activeCount = db
      .prepare("SELECT COUNT(*) AS n FROM claims WHERE claimant_id = ? AND status = 'pending' AND created_at > ?")
      .get(user.id, new Date(Date.now() - 864e5).toISOString()).n;
    if (activeCount >= 5) return fail(res, 429, '待审核认领过多，请等待处理'), true;

    const body = await readJson(req);
    const qs = parseJson(item.questions, []);
    const rawAnswers = Array.isArray(body.answers) ? body.answers : [];
    const message = clean(body.message || '', 0, 300) || '';
    if (qs.length && rawAnswers.length !== qs.length) return fail(res, 400, '请回答全部核验题'), true;
    if (!qs.length && message.length < 10) return fail(res, 400, '请至少写 10 个字的物品描述'), true;
    const answers = qs.map((q, index) => {
      const given = clean(rawAnswers[index], 1, 120) || '';
      return { q: q.q, a: given, match: answerMatch(q.a, given) ? 1 : 0 };
    });
    const matchCount = answers.filter((a) => a.match).length;
    const id = 'cl_' + crypto.randomBytes(6).toString('hex');
    db.prepare(
      'INSERT INTO claims (id, item_id, claimant_id, owner_id, message, answers, match_count, question_count, status, handover_code, claimant_confirmed, owner_confirmed, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)'
    ).run(id, item.id, user.id, item.owner_id, message, JSON.stringify(answers), matchCount, qs.length, 'pending', '', '', nowIso(), nowIso());
    addNotification(item.owner_id, 'claim', '收到新的认领申请', `「${item.title}」收到一条认领申请，特征匹配 ${matchCount}/${qs.length || 0}。`, item.id, id);
    json(res, 201, { claim: claimDTO(claimById(id), user), message: '认领申请已提交' });
    return true;
  }

  const claimAction = pathname.match(/^\/api\/claims\/([^/]+)\/(approve|reject|claimant-confirm|owner-confirm)$/);
  if (claimAction && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return true;
    const claim = claimById(claimAction[1]);
    if (!claim) return fail(res, 404, '认领记录不存在'), true;
    const item = itemById(claim.item_id);
    const action = claimAction[2];

    if (action === 'approve' || action === 'reject') {
      if (claim.owner_id !== user.id) return fail(res, 403, '只有发布者可以处理认领'), true;
      if (claim.status !== 'pending') return fail(res, 409, '该认领已处理'), true;
      if (action === 'reject') {
        db.prepare("UPDATE claims SET status = 'rejected', note = ?, updated_at = ? WHERE id = ?").run('发布者未通过核验', nowIso(), claim.id);
        addNotification(claim.claimant_id, 'claim', '认领未通过', `「${item.title}」的认领申请未通过，请补充更准确的特征。`, item.id, claim.id);
        return json(res, 200, { claim: claimDTO(claimById(claim.id), user) }), true;
      }
      if (item.status !== 'active') return fail(res, 409, '该物品已被其他认领锁定'), true;
      const code = String(crypto.randomInt(100000, 1000000));
      db.exec('BEGIN');
      try {
        db.prepare("UPDATE claims SET status = 'approved', handover_code = ?, updated_at = ? WHERE id = ?").run(code, nowIso(), claim.id);
        db.prepare("UPDATE items SET status = 'claimed' WHERE id = ?").run(item.id);
        db.prepare("UPDATE claims SET status = 'rejected', note = '物品已由其他认领人锁定', updated_at = ? WHERE item_id = ? AND id <> ? AND status = 'pending'").run(nowIso(), item.id, claim.id);
        addNotification(claim.claimant_id, 'claim', '认领已通过', `「${item.title}」认领已通过，请与发布者当面交接并输入交接码。`, item.id, claim.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return json(res, 200, { claim: claimDTO(claimById(claim.id), user), handoverCode: code }), true;
    }

    if (action === 'claimant-confirm') {
      if (claim.claimant_id !== user.id) return fail(res, 403, '无权操作该认领'), true;
      if (claim.status !== 'approved') return fail(res, 409, '当前状态不可确认'), true;
      if (claim.claimant_confirmed) return fail(res, 409, '你已确认过'), true;
      const code = String((await readJson(req)).code || '');
      if (!safeEqual(code, claim.handover_code || '')) return fail(res, 400, '交接码不正确'), true;
      db.prepare('UPDATE claims SET claimant_confirmed = 1, updated_at = ? WHERE id = ?').run(nowIso(), claim.id);
      addNotification(claim.owner_id, 'claim', '认领人已确认收货', `「${item.title}」的认领人已输入交接码，请确认完成交接。`, item.id, claim.id);
      return json(res, 200, { claim: claimDTO(claimById(claim.id), user) }), true;
    }

    if (action === 'owner-confirm') {
      if (claim.owner_id !== user.id) return fail(res, 403, '只有发布者可以确认交接'), true;
      if (claim.status !== 'approved') return fail(res, 409, '当前状态不可确认'), true;
      if (!claim.claimant_confirmed) return fail(res, 409, '请等待认领人输入交接码'), true;
      completeHandover(claim);
      return json(res, 200, { claim: claimDTO(claimById(claim.id), user), item: itemDTO(itemById(item.id), user) }), true;
    }
  }

  if (pathname === '/api/notifications/read' && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return true;
    const body = await readJson(req);
    if (body.id) db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(body.id, user.id);
    else db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(user.id);
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/reports' && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return true;
    if (!rateLimit('report:' + user.id, 10, 24 * 3600 * 1000)) return fail(res, 429, '举报过于频繁'), true;
    const body = await readJson(req);
    const item = itemById(body.itemId);
    const reason = clean(body.reason, 2, 40);
    if (!item || !reason) return fail(res, 400, '举报信息不完整'), true;
    db.prepare('INSERT INTO reports (id, item_id, reporter_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'rp_' + crypto.randomBytes(6).toString('hex'), item.id, user.id, reason, clean(body.detail || '', 0, 200) || '', nowIso()
    );
    json(res, 200, { ok: true });
    return true;
  }

  fail(res, 404, '接口不存在');
  return true;
}

/* ------------------------------ 静态文件 ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};
const DENY = ['.data', 'server', 'server.js', 'server-test.js', 'package.json', 'package-lock.json', '.env', '.git'];

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '方法不允许');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return fail(res, 400, '路径不正确');
  }
  if (pathname === '/') pathname = '/index.html';
  const normalized = pathname.replace(/\\/g, '/');
  if (normalized.split('/').some((part) => part.startsWith('.'))) return fail(res, 404, 'Not found');
  if (DENY.some((d) => normalized === '/' + d || normalized.startsWith('/' + d + '/'))) return fail(res, 404, 'Not found');
  const file = path.resolve(ROOT, '.' + normalized);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return fail(res, 404, 'Not found');
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const noCache = ext === '.html' || ext === '.js' || ext === '.css';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------ 服务器 ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      console.error('[api]', error.status || 500, error.message);
      if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : '服务器内部错误');
    }
    return;
  }
  serveStatic(req, res, url);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  console.log(`[hdu-lost-found] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (!process.env.AUTH_SECRET) console.log('[hdu-lost-found] AUTH_SECRET 未设置：重启后登录会话会失效（生产环境请设置）');
});
