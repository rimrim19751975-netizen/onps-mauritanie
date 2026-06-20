const path = require('path');
const fs = require('fs');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp/data' : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let turso = null;
if (TURSO_URL && TURSO_TOKEN) {
  const { createClient } = require('@libsql/client');
  turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
}

if (isVercel && !TURSO_URL && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const seed = path.join(__dirname, 'data', 'db.json');
  if (fs.existsSync(seed)) fs.copyFileSync(seed, DB_PATH);
}

async function initTurso() {
  if (!turso) return;
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT,
      name TEXT, email TEXT, phone TEXT, profession TEXT, specialite TEXT,
      numero_ordre TEXT, statut TEXT DEFAULT 'en_attente', actif INTEGER DEFAULT 1,
      created_at TEXT
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS actualites (
      id INTEGER PRIMARY KEY, titre_fr TEXT, titre_ar TEXT,
      contenu_fr TEXT, contenu_ar TEXT, date TEXT, statut TEXT DEFAULT 'publie',
      created_by INTEGER, created_at TEXT
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS inscriptions (
      id INTEGER PRIMARY KEY, nom TEXT, email TEXT, telephone TEXT,
      profession TEXT, specialite TEXT, diplome TEXT, annee_experience INTEGER,
      etablissement TEXT, statut TEXT DEFAULT 'en_attente', created_at TEXT
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, nom TEXT, email TEXT, sujet TEXT,
      message TEXT, lu INTEGER DEFAULT 0, created_at TEXT
    )
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)
  `);
  await seedTurso();
}

async function seedTurso() {
  const count = await turso.execute('SELECT COUNT(*) as c FROM users');
  if (count.rows[0].c > 0) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'db.json'), 'utf-8'));
  for (const u of seed.users) {
    await turso.execute('INSERT OR IGNORE INTO users (id,username,password,role,name,email,phone,profession,specialite,numero_ordre,statut,actif,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [u.id, u.username, u.password, u.role, u.name, u.email||'', u.phone||'', u.profession||'', u.specialite||'', u.numero_ordre||'', u.statut||'valide', u.actif!==undefined?u.actif:1, u.createdAt||'']);
  }
  for (const a of seed.actualites) {
    await turso.execute('INSERT INTO actualites (id,titre_fr,titre_ar,contenu_fr,contenu_ar,date,statut,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [a.id, a.titre_fr, a.titre_ar, a.contenu_fr, a.contenu_ar, a.date, a.statut, a.createdBy, a.createdAt]);
  }
  for (const i of seed.inscriptions) {
    await turso.execute('INSERT INTO inscriptions (id,nom,email,telephone,profession,specialite,diplome,annee_experience,etablissement,statut,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [i.id, i.nom, i.email, i.telephone, i.profession, i.specialite, i.diplome, i.annee_experience, i.etablissement, i.statut, i.createdAt]);
  }
  for (const m of seed.messages) {
    await turso.execute('INSERT INTO messages (id,nom,email,sujet,message,lu,created_at) VALUES (?,?,?,?,?,?,?)',
      [m.id, m.nom, m.email, m.sujet, m.message, m.lu?1:0, m.createdAt]);
  }
  if (seed.settings) {
    for (const [k, v] of Object.entries(seed.settings)) {
      await turso.execute('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
  }
}

// ---- JSON helpers (fallback) ----
function readJSON() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = path.join(__dirname, 'data', 'db.json');
    if (fs.existsSync(seed)) fs.copyFileSync(seed, DB_PATH);
    else return { users: [], actualites: [], inscriptions: [], messages: [], settings: {} };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeJSON(d) { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); }

// ---- DB abstraction ----
async function dbQuery(sql, params = []) {
  if (turso) {
    const r = await turso.execute(sql, params);
    return r.rows;
  }
  throw new Error('Turso not available');
}

async function getAllUsers() {
  if (turso) return (await turso.execute('SELECT * FROM users')).rows;
  return readJSON().users;
}
async function getUser(id) {
  if (turso) { const r = await turso.execute('SELECT * FROM users WHERE id=?', [id]); return r.rows[0]; }
  return readJSON().users.find(u => u.id == id);
}
async function getUserByUsername(username) {
  if (turso) { const r = await turso.execute('SELECT * FROM users WHERE username=?', [username]); return r.rows[0]; }
  return readJSON().users.find(u => u.username === username);
}
async function addUser(u) {
  if (turso) {
    await turso.execute('INSERT INTO users (id,username,password,role,name,email,phone,profession,specialite,numero_ordre,statut,actif,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [u.id, u.username, u.password, u.role, u.name, u.email||'', u.phone||'', u.profession||'', u.specialite||'', u.numero_ordre||'', u.statut||'en_attente', u.actif!==undefined?u.actif:1, u.createdAt||new Date().toISOString()]);
    return;
  }
  const db = readJSON(); db.users.push(u); writeJSON(db);
}
async function updateUser(id, data) {
  if (turso) {
    const sets = Object.entries(data).filter(([k]) => k !== 'id').map(([k]) => `${k}=?`).join(',');
    const vals = Object.entries(data).filter(([k]) => k !== 'id').map(([,v]) => v);
    if (sets) await turso.execute(`UPDATE users SET ${sets} WHERE id=?`, [...vals, id]);
    return;
  }
  const db = readJSON(); const idx = db.users.findIndex(u => u.id == id);
  if (idx!==-1) Object.assign(db.users[idx], data); writeJSON(db);
}
async function deleteUser(id) {
  if (turso) { await turso.execute('DELETE FROM users WHERE id=?', [id]); return; }
  const db = readJSON(); db.users = db.users.filter(u => u.id != id); writeJSON(db);
}
async function getUsersByRole(role) {
  if (turso) return (await turso.execute('SELECT * FROM users WHERE role=?', [role])).rows;
  return readJSON().users.filter(u => u.role === role);
}

async function getAllActualites() {
  if (turso) return (await turso.execute('SELECT * FROM actualites ORDER BY date DESC')).rows;
  return readJSON().actualites.sort((a,b) => new Date(b.date) - new Date(a.date));
}
async function getPublishedActualites() {
  if (turso) return (await turso.execute("SELECT * FROM actualites WHERE statut='publie' ORDER BY date DESC")).rows;
  return readJSON().actualites.filter(a => a.statut === 'publie').sort((a,b) => new Date(b.date) - new Date(a.date));
}
async function addActualite(a) {
  if (turso) {
    await turso.execute('INSERT INTO actualites (id,titre_fr,titre_ar,contenu_fr,contenu_ar,date,statut,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [a.id, a.titre_fr, a.titre_ar, a.contenu_fr, a.contenu_ar, a.date, a.statut, a.createdBy, a.createdAt]);
    return;
  }
  const db = readJSON(); db.actualites.push(a); writeJSON(db);
}
async function updateActualite(id, data) {
  if (turso) {
    const sets = Object.entries(data).filter(([k]) => k !== 'id').map(([k]) => `${k}=?`).join(',');
    const vals = Object.entries(data).filter(([k]) => k !== 'id').map(([,v]) => v);
    if (sets) await turso.execute(`UPDATE actualites SET ${sets} WHERE id=?`, [...vals, id]);
    return;
  }
  const db = readJSON(); const idx = db.actualites.findIndex(a => a.id == id);
  if (idx!==-1) Object.assign(db.actualites[idx], data); writeJSON(db);
}
async function deleteActualite(id) {
  if (turso) { await turso.execute('DELETE FROM actualites WHERE id=?', [id]); return; }
  const db = readJSON(); db.actualites = db.actualites.filter(a => a.id != id); writeJSON(db);
}

async function getAllInscriptions() {
  if (turso) return (await turso.execute('SELECT * FROM inscriptions ORDER BY created_at DESC')).rows;
  return readJSON().inscriptions;
}
async function addInscription(i) {
  if (turso) {
    await turso.execute('INSERT INTO inscriptions (id,nom,email,telephone,profession,specialite,diplome,annee_experience,etablissement,statut,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [i.id, i.nom, i.email, i.telephone, i.profession, i.specialite, i.diplome, i.annee_experience, i.etablissement, i.statut, i.createdAt]);
    return;
  }
  const db = readJSON(); db.inscriptions.push(i); writeJSON(db);
}
async function deleteInscription(id) {
  if (turso) { await turso.execute('DELETE FROM inscriptions WHERE id=?', [id]); return; }
  const db = readJSON(); db.inscriptions = db.inscriptions.filter(i => i.id != id); writeJSON(db);
}

async function getAllMessages() {
  if (turso) return (await turso.execute('SELECT * FROM messages ORDER BY created_at DESC')).rows;
  return readJSON().messages;
}
async function addMessage(m) {
  if (turso) {
    await turso.execute('INSERT INTO messages (id,nom,email,sujet,message,lu,created_at) VALUES (?,?,?,?,?,?,?)',
      [m.id, m.nom, m.email, m.sujet, m.message, 0, m.createdAt]);
    return;
  }
  const db = readJSON(); db.messages.push(m); writeJSON(db);
}
async function markMessageRead(id) {
  if (turso) { await turso.execute('UPDATE messages SET lu=1 WHERE id=?', [id]); return; }
  const db = readJSON(); const idx = db.messages.findIndex(m => m.id == id);
  if (idx!==-1) db.messages[idx].lu = true; writeJSON(db);
}
async function deleteMessage(id) {
  if (turso) { await turso.execute('DELETE FROM messages WHERE id=?', [id]); return; }
  const db = readJSON(); db.messages = db.messages.filter(m => m.id != id); writeJSON(db);
}

async function getSetting(key) {
  if (turso) { const r = await turso.execute('SELECT value FROM settings WHERE key=?', [key]); return r.rows[0]?.value; }
  const db = readJSON(); return db.settings?.[key];
}
async function getAllSettings() {
  if (turso) {
    const r = await turso.execute('SELECT key, value FROM settings');
    const s = {};
    for (const row of r.rows) {
      try { s[row.key] = JSON.parse(row.value); } catch { s[row.key] = row.value; }
    }
    return s;
  }
  return readJSON().settings || {};
}
async function setSetting(key, value) {
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (turso) { await turso.execute('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, str]); return; }
  const db = readJSON(); if (!db.settings) db.settings = {}; db.settings[key] = value; writeJSON(db);
}
async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) await setSetting(k, v);
}

async function getStats() {
  if (turso) {
    const [m, mv, ma, a, ins, ms, v] = await Promise.all([
      turso.execute("SELECT COUNT(*) as c FROM users WHERE role='member'"),
      turso.execute("SELECT COUNT(*) as c FROM users WHERE role='member' AND statut='valide'"),
      turso.execute("SELECT COUNT(*) as c FROM users WHERE role='member' AND statut='en_attente'"),
      turso.execute('SELECT COUNT(*) as c FROM actualites'),
      turso.execute('SELECT COUNT(*) as c FROM inscriptions'),
      turso.execute('SELECT COUNT(*) as c FROM messages WHERE lu=0'),
      turso.execute("SELECT COUNT(*) as c FROM users WHERE role='visitor'"),
    ]);
    return { totalMembres: m.rows[0].c, membresValides: mv.rows[0].c, membresEnAttente: ma.rows[0].c, totalActualites: a.rows[0].c, totalInscriptions: ins.rows[0].c, inscriptionsEnAttente: 0, messagesNonLus: ms.rows[0].c, totalVisiteurs: v.rows[0].c };
  }
  const db = readJSON();
  return { totalMembres: db.users.filter(u => u.role==='member').length, membresValides: db.users.filter(u => u.role==='member'&&u.statut==='valide').length, membresEnAttente: db.users.filter(u => u.role==='member'&&u.statut==='en_attente').length, totalActualites: db.actualites.length, totalInscriptions: db.inscriptions.length, inscriptionsEnAttente: db.inscriptions.filter(i => i.statut==='en_attente').length, messagesNonLus: db.messages.filter(m => !m.lu).length, totalVisiteurs: db.users.filter(u => u.role==='visitor').length };
}

module.exports = {
  initTurso, turso,
  getAllUsers, getUser, getUserByUsername, addUser, updateUser, deleteUser, getUsersByRole,
  getAllActualites, getPublishedActualites, addActualite, updateActualite, deleteActualite,
  getAllInscriptions, addInscription, deleteInscription,
  getAllMessages, addMessage, markMessageRead, deleteMessage,
  getSetting, getAllSettings, setSetting, setSettings,
  getStats,
  readJSON, writeJSON,
  isTurso: () => !!turso
};
