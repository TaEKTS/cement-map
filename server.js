'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const ENV_FILE = path.join(ROOT, '.env');
const PUBLIC_DIR = path.join(ROOT, 'public');

loadDotEnv(ENV_FILE);

const PORT = clampInt(process.env.PORT, 1, 65535, 3000);
const HOST = String(process.env.HOST || '0.0.0.0');
const SESSION_HOURS = clampInt(process.env.SESSION_HOURS, 1, 168, 24);
const DEMO_MODE = toBool(process.env.PUBLIC_DEMO_MODE, false);

// Must be initialized before normalizeRole() is called below.
const ROLES = ['VIEWER', 'MEMBER', 'EDITOR', 'ADMIN'];
const DEMO_ROLE = normalizeRole(process.env.DEMO_ROLE || 'EDITOR');

const MAX_POINTS = 500;
const MAX_TIMERS_PER_POINT = 20;
const MAX_HISTORY = 5000;
const MIN_PASSWORD = 8;
const MAX_USERNAME = 30;

const MAP_DIR = prepareMapDirectory();
const DEFAULT_MAP_URL = `/${MAP_DIR.webName}/GTAV_ATLUS_8192x8192.png`;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket', 'polling'],
  pingInterval: 20000,
  pingTimeout: 15000,
  maxHttpBufferSize: 1e6,
});

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '1h',
}));

const sessions = new Map();
const loginFails = new Map();
let mutationQueue = Promise.resolve();

ensureDirectory(DATA_DIR, 'data');
let store = loadStore();
ensureInitialAdmin();


function ensureDirectory(dirPath, label = 'directory') {
  if (fs.existsSync(dirPath)) {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`${label} path exists but is not a directory: ${dirPath}`);
    }
    return dirPath;
  }

  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function prepareMapDirectory() {
  ensureDirectory(PUBLIC_DIR, 'public');

  const preferred = path.join(PUBLIC_DIR, 'maps');
  if (!fs.existsSync(preferred)) {
    fs.mkdirSync(preferred, { recursive: true });
    return { fsPath: preferred, webName: 'maps' };
  }

  if (fs.statSync(preferred).isDirectory()) {
    return { fsPath: preferred, webName: 'maps' };
  }

  // Some GitHub uploads can accidentally create `public/maps` as a file.
  // Do not crash the whole server; fall back to a safe folder instead.
  const fallback = path.join(PUBLIC_DIR, 'map-assets');
  ensureDirectory(fallback, 'map-assets');
  console.warn('[MAP] public/maps is a file, not a folder. Using public/map-assets instead.');
  return { fsPath: fallback, webName: 'map-assets' };
}

function defaultStore() {
  return {
    version: 2,
    revision: 1,
    settings: {
      appName: 'Cement Map',
      mapImageUrl: DEFAULT_MAP_URL,
      syncSeconds: 3,
      alert3Minutes: 3,
      alert2Minutes: 2,
    },
    points: [],
    users: [],
    history: [],
  };
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return defaultStore();

  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const base = defaultStore();

    const mergedSettings = { ...base.settings, ...(data.settings || {}) };
    if (MAP_DIR.webName !== 'maps' && String(mergedSettings.mapImageUrl || '').startsWith('/maps/')) {
      mergedSettings.mapImageUrl = `/${MAP_DIR.webName}/` + String(mergedSettings.mapImageUrl).slice('/maps/'.length);
    }

    return {
      ...base,
      ...data,
      version: 2,
      settings: mergedSettings,
      points: Array.isArray(data.points) ? data.points.map(normalizePointRecord) : [],
      users: Array.isArray(data.users) ? data.users : [],
      history: Array.isArray(data.history) ? data.history : [],
      revision: Number(data.revision || 1),
    };
  } catch (err) {
    console.error('[STORE] อ่าน store.json ไม่สำเร็จ:', err.message);
    const backup = STORE_FILE + '.broken-' + Date.now();
    try { fs.copyFileSync(STORE_FILE, backup); } catch (_) {}
    return defaultStore();
  }
}

async function saveStoreAtomic() {
  const tmp = STORE_FILE + '.tmp';
  const payload = JSON.stringify(store, null, 2);
  await fs.promises.writeFile(tmp, payload, 'utf8');
  await fs.promises.rename(tmp, STORE_FILE);
}

function ensureInitialAdmin() {
  const exists = store.users.some(u => u.role === 'ADMIN' && u.enabled !== false);
  if (exists) {
    // Ensure store is on disk even when migrated from an older shape.
    saveStoreAtomic().catch(console.error);
    return;
  }

  const username = normalizeUsername(process.env.CEMENT_ADMIN_USERNAME || 'admin') || 'admin';
  const envPassword = String(process.env.CEMENT_ADMIN_PASSWORD || '');
  const password = envPassword.length >= MIN_PASSWORD ? envPassword : makeTempPassword(14);

  const user = createUserRecord({
    username,
    displayName: 'Owner',
    password,
    role: 'ADMIN',
    enabled: true,
    mustChangePassword: false,
  });

  store.users.push(user);
  addHistory('SYSTEM', 'CREATE_INITIAL_ADMIN', '', username);
  store.revision++;
  saveStoreAtomic().catch(console.error);

  console.log('');
  console.log('============================================================');
  console.log(' CEMENT MAP - INITIAL ADMIN');
  console.log(' Username:', username);
  console.log(' Password:', password);
  console.log(' บันทึกรหัสนี้ไว้ แล้วเปลี่ยนรหัสผ่านหลัง Login');
  console.log(' ระบบเก็บเฉพาะ Password Hash ใน data/store.json');
  console.log('============================================================');
  console.log('');
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const i = line.indexOf('=');
    if (i <= 0) continue;

    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeUsername(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,30}$/.test(s)) return '';
  return s;
}

function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase();
  return ROLES.includes(role) ? role : 'MEMBER';
}

function cleanName(value, max = 50) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanDisplayName(value) {
  return cleanName(value, 50);
}


function normalizeTimerRecord(timer, index, pointLike = {}) {
  const fallbackName = `กอง ${index + 1}`;
  const rawEndAt = Number(timer?.endAt || 0);
  const wantsTimer = String(timer?.state || '').toUpperCase() === 'TIMER' && rawEndAt > 0;

  return {
    id: String(timer?.id || crypto.randomUUID()),
    name: cleanName(timer?.name || fallbackName, 30) || fallbackName,
    state: wantsTimer ? 'TIMER' : 'WAITING',
    endAt: wantsTimer ? rawEndAt : '',
    createdBy: String(timer?.createdBy || pointLike.createdBy || ''),
    updatedBy: String(timer?.updatedBy || pointLike.updatedBy || pointLike.createdBy || ''),
    createdAt: Number(timer?.createdAt || pointLike.createdAt || Date.now()),
    updatedAt: Number(timer?.updatedAt || pointLike.updatedAt || pointLike.createdAt || Date.now()),
  };
}

function normalizePointRecord(point) {
  const p = point && typeof point === 'object' ? point : {};
  let rawTimers = Array.isArray(p.timers) ? p.timers.filter(Boolean) : [];

  // Migration from the old 1-point = 1-timer format.
  if (!rawTimers.length) {
    rawTimers = [{
      name: 'กอง 1',
      state: p.state === 'TIMER' && p.endAt ? 'TIMER' : 'WAITING',
      endAt: p.endAt || '',
      createdBy: p.createdBy || '',
      updatedBy: p.updatedBy || p.createdBy || '',
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || p.createdAt || Date.now(),
    }];
  }

  const timers = rawTimers.slice(0, MAX_TIMERS_PER_POINT)
    .map((timer, index) => normalizeTimerRecord(timer, index, p));

  return {
    ...p,
    id: String(p.id || crypto.randomUUID()),
    name: cleanName(p.name || 'จุดปูน', 50) || 'จุดปูน',
    x: clamp01(p.x),
    y: clamp01(p.y),
    timers,
    createdBy: String(p.createdBy || ''),
    updatedBy: String(p.updatedBy || p.createdBy || ''),
    createdAt: Number(p.createdAt || Date.now()),
    updatedAt: Number(p.updatedAt || p.createdAt || Date.now()),
  };
}

function findTimer(point, timerId) {
  if (!point || !Array.isArray(point.timers)) return null;
  return point.timers.find(t => t.id === String(timerId || '')) || null;
}

function makeTimer({ name, state, minutes, username }) {
  const now = Date.now();
  const timerState = String(state || 'WAITING').toUpperCase() === 'TIMER' ? 'TIMER' : 'WAITING';
  const numericMinutes = Number(minutes || 0);

  if (timerState === 'TIMER' && (!Number.isFinite(numericMinutes) || numericMinutes <= 0 || numericMinutes > 10080)) {
    throw new Error('เวลาต้องอยู่ระหว่าง 1 ถึง 10,080 นาที');
  }

  return {
    id: crypto.randomUUID(),
    name: cleanName(name || 'กอง', 30) || 'กอง',
    state: timerState,
    endAt: timerState === 'TIMER' ? now + Math.round(numericMinutes * 60000) : '',
    createdBy: username,
    updatedBy: username,
    createdAt: now,
    updatedAt: now,
  };
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function makeTempPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  try {
    const actual = crypto.scryptSync(String(password), String(salt), 64);
    const wanted = Buffer.from(String(expected), 'hex');
    return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
  } catch (_) {
    return false;
  }
}

function createUserRecord({ username, displayName, password, role, enabled, mustChangePassword }) {
  const { salt, hash } = hashPassword(password);
  const now = Date.now();

  return {
    username,
    displayName: cleanDisplayName(displayName || username),
    salt,
    passwordHash: hash,
    role: normalizeRole(role),
    enabled: enabled !== false,
    mustChangePassword: !!mustChangePassword,
    createdAt: now,
    lastLogin: 0,
  };
}

function publicUser(user) {
  return {
    username: String(user.username || ''),
    displayName: String(user.displayName || user.username || ''),
    role: normalizeRole(user.role),
    enabled: user.enabled !== false,
    mustChangePassword: !!user.mustChangePassword,
    createdAt: Number(user.createdAt || 0),
    lastLogin: Number(user.lastLogin || 0),
  };
}

function findUser(username) {
  username = normalizeUsername(username);
  return store.users.find(u => u.username === username) || null;
}

function findPoint(id) {
  return store.points.find(p => p.id === String(id || '')) || null;
}

function addHistory(username, action, pointId = '', details = '') {
  store.history.push({
    timestamp: Date.now(),
    username: String(username || ''),
    action: String(action || ''),
    pointId: String(pointId || ''),
    details: typeof details === 'string' ? details : JSON.stringify(details),
  });

  if (store.history.length > MAX_HISTORY) {
    store.history.splice(0, store.history.length - MAX_HISTORY);
  }
}

function createSession(userLike) {
  const token = randomToken(36);
  sessions.set(token, {
    username: String(userLike.username || ''),
    displayName: String(userLike.displayName || userLike.username || ''),
    role: normalizeRole(userLike.role),
    mustChangePassword: !!userLike.mustChangePassword,
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_HOURS * 3600000,
    demo: !!userLike.demo,
  });
  return token;
}

function requireSession(token) {
  const session = sessions.get(String(token || ''));
  if (!session) throw new Error('SESSION_EXPIRED');

  if (Date.now() > session.expiresAt) {
    sessions.delete(String(token || ''));
    throw new Error('SESSION_EXPIRED');
  }

  if (!session.demo) {
    const user = findUser(session.username);
    if (!user || user.enabled === false) {
      sessions.delete(String(token || ''));
      throw new Error('SESSION_EXPIRED');
    }

    session.displayName = user.displayName;
    session.role = user.role;
    session.mustChangePassword = !!user.mustChangePassword;
  }

  return session;
}

function requireRole(token, roles) {
  const session = requireSession(token);
  if (!roles.includes(session.role)) throw new Error('ไม่มีสิทธิ์ใช้คำสั่งนี้');
  return session;
}

function ensureAnotherAdmin(excludeUsername) {
  const count = store.users.filter(
    u => u.username !== excludeUsername && u.role === 'ADMIN' && u.enabled !== false
  ).length;

  if (count < 1) throw new Error('ต้องมี Admin ที่เปิดใช้งานอย่างน้อย 1 บัญชี');
}

function broadcastChange(action, username) {
  io.emit('state:changed', {
    revision: store.revision,
    action: String(action || ''),
    by: String(username || ''),
    serverNow: Date.now(),
  });
}

function mutate(username, action, fn) {
  const job = mutationQueue.then(async () => {
    const result = await fn();

    store.revision = Math.max(1, Number(store.revision || 0) + 1);
    await saveStoreAtomic();
    broadcastChange(action, username);

    return {
      ...result,
      revision: store.revision,
    };
  });

  mutationQueue = job.catch(() => {});
  return job;
}

function getSettings() {
  return {
    appName: cleanName(store.settings.appName || 'Cement Map', 60) || 'Cement Map',
    mapImageUrl: String(store.settings.mapImageUrl || ''),
    syncSeconds: clampInt(store.settings.syncSeconds, 1, 60, 3),
    alert3Minutes: clampInt(store.settings.alert3Minutes, 2, 60, 3),
    alert2Minutes: clampInt(store.settings.alert2Minutes, 1, 59, 2),
  };
}

function getPoints() {
  return store.points.map(rawPoint => {
    const p = normalizePointRecord(rawPoint);
    const timers = p.timers.map((t, index) => ({
      id: String(t.id),
      name: cleanName(t.name || `กอง ${index + 1}`, 30) || `กอง ${index + 1}`,
      state: t.state === 'TIMER' && t.endAt ? 'TIMER' : 'WAITING',
      endAt: t.endAt ? Number(t.endAt) : '',
      createdBy: String(t.createdBy || ''),
      updatedBy: String(t.updatedBy || ''),
      createdAt: Number(t.createdAt || 0),
      updatedAt: Number(t.updatedAt || 0),
    }));

    // Legacy summary fields are kept so an older client does not crash.
    const timed = timers.filter(t => t.state === 'TIMER' && t.endAt)
      .sort((a, b) => Number(a.endAt) - Number(b.endAt));
    const lead = timed[0] || null;

    return {
      id: String(p.id),
      name: String(p.name),
      x: Number(p.x),
      y: Number(p.y),
      timers,
      timerCount: timers.length,
      state: lead ? 'TIMER' : 'WAITING',
      endAt: lead ? Number(lead.endAt) : '',
      createdBy: String(p.createdBy || ''),
      updatedBy: String(p.updatedBy || ''),
      createdAt: Number(p.createdAt || 0),
      updatedAt: Number(p.updatedAt || 0),
    };
  });
}

function getPublicUsers() {
  return store.users.map(publicUser);
}

function tooManyLoginFails(username) {
  const now = Date.now();
  const entry = loginFails.get(username);

  if (!entry || now > entry.resetAt) {
    loginFails.delete(username);
    return false;
  }

  return entry.count >= 5;
}

function recordLoginFail(username) {
  const now = Date.now();
  const entry = loginFails.get(username);

  if (!entry || now > entry.resetAt) {
    loginFails.set(username, { count: 1, resetAt: now + 5 * 60000 });
    return;
  }

  entry.count++;
}

function clearLoginFails(username) {
  loginFails.delete(username);
}

// -----------------------------
// RPC methods
// -----------------------------

const rpc = {
  async getPublicConfig() {
    const settings = getSettings();
    return {
      ok: true,
      appName: settings.appName,
      accounts: 'admin-only',
      demoMode: DEMO_MODE,
      transport: 'websocket',
    };
  },

  async demoLogin() {
    if (!DEMO_MODE) throw new Error('Demo mode ปิดอยู่');

    const token = createSession({
      username: 'demo',
      displayName: 'Demo User',
      role: DEMO_ROLE,
      mustChangePassword: false,
      demo: true,
    });

    return {
      ok: true,
      token,
      user: {
        username: 'demo',
        displayName: 'Demo User',
        role: DEMO_ROLE,
        enabled: true,
        mustChangePassword: false,
      },
    };
  },

  async login(username, password) {
    username = normalizeUsername(username);
    password = String(password || '');

    if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
    if (tooManyLoginFails(username)) throw new Error('ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอประมาณ 5 นาที');

    const user = findUser(username);
    if (!user || user.enabled === false || !verifyPassword(password, user.salt, user.passwordHash)) {
      recordLoginFail(username);
      throw new Error('Username หรือ Password ไม่ถูกต้อง');
    }

    clearLoginFails(username);
    user.lastLogin = Date.now();

    const token = createSession(user);
    addHistory(username, 'LOGIN', '', 'เข้าสู่ระบบ');
    await saveStoreAtomic();

    return {
      ok: true,
      token,
      user: publicUser(user),
    };
  },

  async logout(token) {
    sessions.delete(String(token || ''));
    return { ok: true };
  },

  async changeMyPassword(token, oldPassword, newPassword) {
    const session = requireSession(token);
    if (session.demo) throw new Error('Demo User เปลี่ยน Password ไม่ได้');

    newPassword = String(newPassword || '');
    if (newPassword.length < MIN_PASSWORD) {
      throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    }

    const user = findUser(session.username);
    if (!user || !verifyPassword(String(oldPassword || ''), user.salt, user.passwordHash)) {
      throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    return mutate(session.username, 'CHANGE_PASSWORD', async () => {
      const { salt, hash } = hashPassword(newPassword);
      user.salt = salt;
      user.passwordHash = hash;
      user.mustChangePassword = false;

      session.mustChangePassword = false;
      addHistory(session.username, 'CHANGE_PASSWORD', '', 'เปลี่ยนรหัสผ่านของตัวเอง');

      return { ok: true, user: publicUser(user) };
    });
  },

  async bootstrap(token) {
    const session = requireSession(token);

    return {
      ok: true,
      user: publicUser(session),
      settings: getSettings(),
      revision: store.revision,
      points: getPoints(),
      users: session.role === 'ADMIN' ? getPublicUsers() : [],
      serverNow: Date.now(),
      realtime: true,
    };
  },

  async syncData(token, knownRevision) {
    const session = requireSession(token);

    if (Number(knownRevision) === Number(store.revision)) {
      return {
        ok: true,
        changed: false,
        revision: store.revision,
        serverNow: Date.now(),
      };
    }

    return {
      ok: true,
      changed: true,
      revision: store.revision,
      points: getPoints(),
      settings: getSettings(),
      users: session.role === 'ADMIN' ? getPublicUsers() : [],
      serverNow: Date.now(),
    };
  },

  async createPoint(token, payload = {}) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);
    const name = cleanName(payload.name);
    const x = clamp01(payload.x);
    const y = clamp01(payload.y);
    const timerState = String(payload.state || 'WAITING').toUpperCase() === 'TIMER' ? 'TIMER' : 'WAITING';
    const minutes = Number(payload.minutes || 0);

    if (!name) throw new Error('กรุณาใส่ชื่อจุด');
    if (timerState === 'TIMER' && (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080)) {
      throw new Error('เวลาต้องอยู่ระหว่าง 1 ถึง 10,080 นาที');
    }

    return mutate(session.username, 'CREATE_POINT', async () => {
      if (store.points.length >= MAX_POINTS) throw new Error(`จำนวนจุดถึงขีดจำกัด ${MAX_POINTS} จุด`);

      const now = Date.now();
      const id = crypto.randomUUID();
      const firstTimer = makeTimer({
        name: cleanName(payload.timerName || 'กอง 1', 30) || 'กอง 1',
        state: timerState,
        minutes,
        username: session.username,
      });

      store.points.push({
        id,
        name,
        x,
        y,
        timers: [firstTimer],
        createdBy: session.username,
        updatedBy: session.username,
        createdAt: now,
        updatedAt: now,
      });

      addHistory(session.username, 'CREATE_POINT', id, {
        name, x, y, timerName: firstTimer.name, state: timerState, minutes,
      });
      return { ok: true, pointId: id, timerId: firstTimer.id };
    });
  },

  async addPointTimer(token, pointId, payload = {}) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);

    return mutate(session.username, 'ADD_POINT_TIMER', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');
      point.timers = Array.isArray(point.timers) ? point.timers : [];
      if (point.timers.length >= MAX_TIMERS_PER_POINT) {
        throw new Error(`1 จุดมีได้สูงสุด ${MAX_TIMERS_PER_POINT} กอง`);
      }

      const defaultName = `กอง ${point.timers.length + 1}`;
      const timer = makeTimer({
        name: cleanName(payload.name || defaultName, 30) || defaultName,
        state: payload.state || 'WAITING',
        minutes: payload.minutes || 0,
        username: session.username,
      });

      point.timers.push(timer);
      point.updatedBy = session.username;
      point.updatedAt = Date.now();

      addHistory(session.username, 'ADD_POINT_TIMER', point.id, {
        point: point.name,
        timerId: timer.id,
        timerName: timer.name,
        state: timer.state,
      });
      return { ok: true, timerId: timer.id };
    });
  },

  async setPointTimer(token, pointId, timerIdOrMinutes, maybeMinutes) {
    const session = requireRole(token, ['MEMBER', 'EDITOR', 'ADMIN']);

    // Backward compatible with the old signature: setPointTimer(token, pointId, minutes)
    const oldSignature = maybeMinutes == null;
    const timerId = oldSignature ? '' : String(timerIdOrMinutes || '');
    const minutes = Number(oldSignature ? timerIdOrMinutes : maybeMinutes);

    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) {
      throw new Error('เวลาต้องอยู่ระหว่าง 1 ถึง 10,080 นาที');
    }

    return mutate(session.username, 'SET_TIMER', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');
      point.timers = Array.isArray(point.timers) && point.timers.length
        ? point.timers
        : [normalizeTimerRecord({}, 0, point)];

      const timer = timerId ? findTimer(point, timerId) : point.timers[0];
      if (!timer) throw new Error('ไม่พบกองนี้');

      timer.state = 'TIMER';
      timer.endAt = Date.now() + Math.round(minutes * 60000);
      timer.updatedBy = session.username;
      timer.updatedAt = Date.now();
      point.updatedBy = session.username;
      point.updatedAt = timer.updatedAt;

      addHistory(session.username, 'SET_TIMER', point.id, {
        point: point.name,
        timerId: timer.id,
        timerName: timer.name,
        minutes,
        endAt: timer.endAt,
      });

      return { ok: true, timerId: timer.id, endAt: timer.endAt };
    });
  },

  async setPointTimerWaiting(token, pointId, timerId) {
    const session = requireRole(token, ['MEMBER', 'EDITOR', 'ADMIN']);

    return mutate(session.username, 'SET_TIMER_WAITING', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');
      const timer = findTimer(point, timerId);
      if (!timer) throw new Error('ไม่พบกองนี้');

      timer.state = 'WAITING';
      timer.endAt = '';
      timer.updatedBy = session.username;
      timer.updatedAt = Date.now();
      point.updatedBy = session.username;
      point.updatedAt = timer.updatedAt;

      addHistory(session.username, 'SET_TIMER_WAITING', point.id, {
        point: point.name,
        timerId: timer.id,
        timerName: timer.name,
      });
      return { ok: true };
    });
  },

  async renamePointTimer(token, pointId, timerId, newName) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);
    newName = cleanName(newName, 30);
    if (!newName) throw new Error('ชื่อกองห้ามว่าง');

    return mutate(session.username, 'RENAME_POINT_TIMER', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');
      const timer = findTimer(point, timerId);
      if (!timer) throw new Error('ไม่พบกองนี้');

      const old = timer.name;
      timer.name = newName;
      timer.updatedBy = session.username;
      timer.updatedAt = Date.now();
      point.updatedBy = session.username;
      point.updatedAt = timer.updatedAt;

      addHistory(session.username, 'RENAME_POINT_TIMER', point.id, `${old} -> ${newName}`);
      return { ok: true };
    });
  },

  async deletePointTimer(token, pointId, timerId) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);

    return mutate(session.username, 'DELETE_POINT_TIMER', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');
      if (!Array.isArray(point.timers) || point.timers.length <= 1) {
        throw new Error('ต้องเหลืออย่างน้อย 1 กองในแต่ละจุด');
      }

      const index = point.timers.findIndex(t => t.id === String(timerId || ''));
      if (index < 0) throw new Error('ไม่พบกองนี้');
      const [timer] = point.timers.splice(index, 1);

      point.updatedBy = session.username;
      point.updatedAt = Date.now();
      addHistory(session.username, 'DELETE_POINT_TIMER', point.id, {
        point: point.name,
        timerId: timer.id,
        timerName: timer.name,
      });
      return { ok: true };
    });
  },

  // Legacy command: set every stack in the point to waiting.
  async setPointWaiting(token, pointId) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);

    return mutate(session.username, 'SET_WAITING', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');

      point.timers = Array.isArray(point.timers) && point.timers.length
        ? point.timers
        : [normalizeTimerRecord({}, 0, point)];
      const now = Date.now();
      point.timers.forEach(timer => {
        timer.state = 'WAITING';
        timer.endAt = '';
        timer.updatedBy = session.username;
        timer.updatedAt = now;
      });
      point.updatedBy = session.username;
      point.updatedAt = now;

      addHistory(session.username, 'SET_WAITING', point.id, `${point.name} / ทุกกอง`);
      return { ok: true };
    });
  },

  async renamePoint(token, pointId, newName) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);
    newName = cleanName(newName);
    if (!newName) throw new Error('ชื่อจุดห้ามว่าง');

    return mutate(session.username, 'RENAME_POINT', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');

      const old = point.name;
      point.name = newName;
      point.updatedBy = session.username;
      point.updatedAt = Date.now();

      addHistory(session.username, 'RENAME_POINT', point.id, `${old} -> ${newName}`);
      return { ok: true };
    });
  },

  async movePoint(token, pointId, x, y) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);
    x = clamp01(x);
    y = clamp01(y);

    return mutate(session.username, 'MOVE_POINT', async () => {
      const point = findPoint(pointId);
      if (!point) throw new Error('ไม่พบจุดนี้');

      point.x = x;
      point.y = y;
      point.updatedBy = session.username;
      point.updatedAt = Date.now();

      addHistory(session.username, 'MOVE_POINT', point.id, { x, y });
      return { ok: true };
    });
  },

  async deletePoint(token, pointId) {
    const session = requireRole(token, ['EDITOR', 'ADMIN']);

    return mutate(session.username, 'DELETE_POINT', async () => {
      const index = store.points.findIndex(p => p.id === String(pointId || ''));
      if (index < 0) throw new Error('ไม่พบจุดนี้');

      const [point] = store.points.splice(index, 1);
      addHistory(session.username, 'DELETE_POINT', point.id, point.name);
      return { ok: true };
    });
  },

  async adminCreateUser(token, payload = {}) {
    const session = requireRole(token, ['ADMIN']);
    const username = normalizeUsername(payload.username);
    const displayName = cleanDisplayName(payload.displayName || username);
    const role = normalizeRole(payload.role || 'MEMBER');

    if (!username) throw new Error('Username ใช้ได้เฉพาะ a-z, 0-9, . _ - และยาวไม่เกิน 30 ตัว');
    if (findUser(username)) throw new Error('Username นี้มีอยู่แล้ว');

    return mutate(session.username, 'CREATE_USER', async () => {
      const tempPassword = makeTempPassword();

      store.users.push(createUserRecord({
        username,
        displayName,
        password: tempPassword,
        role,
        enabled: true,
        mustChangePassword: true,
      }));

      addHistory(session.username, 'CREATE_USER', '', `${username} / ${role}`);

      return {
        ok: true,
        username,
        tempPassword,
      };
    });
  },

  async adminUpdateUser(token, payload = {}) {
    const session = requireRole(token, ['ADMIN']);
    const username = normalizeUsername(payload.username);
    const target = findUser(username);

    if (!target) throw new Error('ไม่พบ User');

    const newRole = normalizeRole(payload.role || target.role);
    const enabled = payload.enabled !== false;
    const displayName = cleanDisplayName(payload.displayName || target.displayName);

    if (username === session.username && (!enabled || newRole !== 'ADMIN')) {
      throw new Error('ห้ามลดสิทธิ์หรือปิดบัญชี Admin ที่กำลังใช้งานอยู่');
    }

    return mutate(session.username, 'UPDATE_USER', async () => {
      if (target.role === 'ADMIN' && (newRole !== 'ADMIN' || !enabled)) {
        ensureAnotherAdmin(username);
      }

      target.displayName = displayName;
      target.role = newRole;
      target.enabled = enabled;

      addHistory(session.username, 'UPDATE_USER', '', {
        username,
        displayName,
        role: newRole,
        enabled,
      });

      return { ok: true };
    });
  },

  async adminResetPassword(token, username) {
    const session = requireRole(token, ['ADMIN']);
    username = normalizeUsername(username);

    return mutate(session.username, 'RESET_PASSWORD', async () => {
      const target = findUser(username);
      if (!target) throw new Error('ไม่พบ User');

      const tempPassword = makeTempPassword();
      const { salt, hash } = hashPassword(tempPassword);

      target.salt = salt;
      target.passwordHash = hash;
      target.mustChangePassword = true;

      addHistory(session.username, 'RESET_PASSWORD', '', username);

      return {
        ok: true,
        username,
        tempPassword,
      };
    });
  },

  async adminSaveSettings(token, payload = {}) {
    const session = requireRole(token, ['ADMIN']);

    const appName = cleanName(payload.appName || 'Cement Map', 60) || 'Cement Map';
    const mapImageUrl = String(payload.mapImageUrl || '').trim().slice(0, 1000);
    const syncSeconds = clampInt(payload.syncSeconds, 1, 60, 3);
    const alert3Minutes = clampInt(payload.alert3Minutes, 2, 60, 3);
    const alert2Minutes = clampInt(payload.alert2Minutes, 1, 59, 2);

    if (alert2Minutes >= alert3Minutes) {
      throw new Error('ค่าเตือน 2 ต้องน้อยกว่าค่าเตือน 3');
    }

    if (mapImageUrl && !/^https:\/\//i.test(mapImageUrl) && !mapImageUrl.startsWith('/maps/')) {
      throw new Error('MAP IMAGE ต้องเป็น https:// หรือไฟล์ใน /maps/');
    }

    return mutate(session.username, 'SAVE_SETTINGS', async () => {
      store.settings = {
        appName,
        mapImageUrl,
        syncSeconds,
        alert3Minutes,
        alert2Minutes,
      };

      addHistory(session.username, 'SAVE_SETTINGS', '', store.settings);

      return {
        ok: true,
        settings: getSettings(),
      };
    });
  },

  async getRecentHistory(token, limit) {
    requireSession(token);
    limit = clampInt(limit, 1, 100, 40);
    return store.history.slice(-limit).reverse();
  },
};

// -----------------------------
// HTTP RPC
// -----------------------------

app.post('/api/rpc', async (req, res) => {
  const name = String(req.body?.name || '');
  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  const fn = rpc[name];

  if (!fn) {
    res.status(404).json({ ok: false, error: 'ไม่พบ Server function: ' + name });
    return;
  }

  try {
    const result = await fn(...args);
    res.json({ ok: true, result });
  } catch (err) {
    const message = err?.message || String(err || 'Server error');
    const status = message === 'SESSION_EXPIRED' ? 401 : 400;
    res.status(status).json({ ok: false, error: message });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    app: getSettings().appName,
    revision: store.revision,
    points: store.points.length,
    clients: io.engine.clientsCount,
    realtime: true,
    serverNow: Date.now(),
  });
});

// SPA fallback (works with Express 4 and 5).
app.use((_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// -----------------------------
// WebSocket auth + realtime
// -----------------------------

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || '');
    const session = requireSession(token);
    socket.data.token = token;
    socket.data.username = session.username;
    socket.data.role = session.role;
    next();
  } catch (_) {
    next(new Error('SESSION_EXPIRED'));
  }
});

io.on('connection', socket => {
  socket.emit('state:changed', {
    revision: store.revision,
    action: 'CONNECTED',
    by: socket.data.username,
    serverNow: Date.now(),
  });
});

// -----------------------------
// Graceful shutdown / cleanup
// -----------------------------

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) sessions.delete(token);
  }

  for (const [username, fail] of loginFails.entries()) {
    if (now > fail.resetAt) loginFails.delete(username);
  }
}, 60000).unref();

async function shutdown(signal) {
  console.log(`\n[${signal}] กำลังปิด Server...`);

  try {
    await saveStoreAtomic();
  } catch (err) {
    console.error('บันทึกข้อมูลก่อนปิดไม่สำเร็จ:', err.message);
  }

  io.close();
  httpServer.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

httpServer.listen(PORT, HOST, () => {
  console.log('');
  console.log('============================================================');
  console.log(' Cement Map Realtime Server v2.3.0');
  console.log(` Local: http://127.0.0.1:${PORT}`);
  console.log(` LAN:   http://<IP-เครื่องเซิฟ>:${PORT}`);
  console.log(` Realtime: Socket.IO WebSocket`);
  console.log(` Demo mode: ${DEMO_MODE ? 'ON (' + DEMO_ROLE + ')' : 'OFF'}`);
  console.log(` Data: ${STORE_FILE}`);
  console.log(` Map folder: ${MAP_DIR.fsPath}`);
  console.log(' Health: /health');
  console.log('============================================================');
  console.log('');
});