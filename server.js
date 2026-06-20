const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp/data' : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (isVercel && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const seed = path.join(__dirname, 'data', 'db.json');
  if (fs.existsSync(seed)) fs.copyFileSync(seed, DB_PATH);
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use(session({
  secret: 'onps-mr-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function readDB() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); }
function writeDB(d) { fs.writeFileSync(DB_PATH, JSON.stringify(d, null, 2)); }

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
    if (role && req.session.user.role !== role) return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}

// ---- AUTH ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
  if (user.role === 'visitor') {
    if (!user.actif) return res.status(403).json({ error: 'Compte désactivé par l\'administrateur' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role, name: user.name, statut: user.statut || 'actif' };
  res.json({ user: req.session.user });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  res.json({ user: req.session.user });
});

// ---- PUBLIC ----
app.get('/api/public/actualites', (req, res) => {
  const db = readDB();
  res.json({ actualites: db.actualites.filter(a => a.statut === 'publie').sort((a,b) => new Date(b.date) - new Date(a.date)) });
});
app.post('/api/public/inscription', (req, res) => {
  const db = readDB();
  const ins = { id: Date.now(), ...req.body, statut: 'en_attente', createdAt: new Date().toISOString() };
  db.inscriptions.push(ins); writeDB(db); res.json({ success: true });
});
app.post('/api/public/contact', (req, res) => {
  const db = readDB();
  const msg = { id: Date.now(), ...req.body, lu: false, createdAt: new Date().toISOString() };
  db.messages.push(msg); writeDB(db); res.json({ success: true });
});

// ---- ACTUALITES CRUD ----
app.get('/api/actualites', requireAuth('admin'), (req, res) => {
  const db = readDB(); res.json({ actualites: db.actualites });
});
app.post('/api/actualites', requireAuth('admin'), (req, res) => {
  const db = readDB();
  const a = { id: Date.now(), ...req.body, createdBy: req.session.user.id, createdAt: new Date().toISOString() };
  db.actualites.push(a); writeDB(db); res.json({ actualite: a });
});
app.put('/api/actualites/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); const idx = db.actualites.findIndex(a => a.id == req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Non trouvé' });
  Object.assign(db.actualites[idx], req.body, { id: db.actualites[idx].id }); writeDB(db); res.json({ actualite: db.actualites[idx] });
});
app.delete('/api/actualites/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); db.actualites = db.actualites.filter(a => a.id != req.params.id);
  writeDB(db); res.json({ success: true });
});

// ---- MEMBRES (admin + member self) ----
app.get('/api/membres', requireAuth('admin'), (req, res) => {
  const db = readDB();
  res.json({ membres: db.users.filter(u => u.role === 'member').map(u => ({ ...u, password: undefined })) });
});
app.get('/api/membres/:id', requireAuth(), (req, res) => {
  const db = readDB();
  if (req.session.user.role !== 'admin' && req.session.user.id != req.params.id) return res.status(403).json({ error: 'Accès refusé' });
  const m = db.users.find(u => u.id == req.params.id);
  if (!m) return res.status(404).json({ error: 'Non trouvé' });
  res.json({ membre: { ...m, password: undefined } });
});
app.put('/api/membres/:id/statut', requireAuth('admin'), (req, res) => {
  const db = readDB(); const idx = db.users.findIndex(u => u.id == req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Non trouvé' });
  db.users[idx].statut = req.body.statut; writeDB(db); res.json({ success: true });
});
app.post('/api/membres', requireAuth('admin'), (req, res) => {
  const db = readDB();
  if (db.users.find(u => u.username === req.body.username)) return res.status(400).json({ error: 'Nom déjà pris' });
  const m = { id: Date.now(), username: req.body.username, password: 'user', role: 'member', ...req.body, password: req.body.password || 'user', statut: 'en_attente' };
  db.users.push(m); writeDB(db); res.json({ membre: { ...m, password: undefined } });
});
app.delete('/api/membres/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); db.users = db.users.filter(u => u.id != req.params.id);
  writeDB(db); res.json({ success: true });
});

// ---- VISITEURS (admin) ----
app.get('/api/visiteurs', requireAuth('admin'), (req, res) => {
  const db = readDB();
  res.json({ visiteurs: db.users.filter(u => u.role === 'visitor').map(u => ({ ...u, password: undefined })) });
});
app.post('/api/visiteurs', requireAuth('admin'), (req, res) => {
  const db = readDB();
  if (db.users.find(u => u.username === req.body.username)) return res.status(400).json({ error: 'Nom d\'utilisateur déjà pris' });
  const v = { id: Date.now(), username: req.body.username, password: req.body.password || 'visiteur123', role: 'visitor', name: req.body.name || req.body.username, actif: true, createdAt: new Date().toISOString() };
  db.users.push(v); writeDB(db); res.json({ visiteur: { ...v, password: undefined } });
});
app.put('/api/visiteurs/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); const idx = db.users.findIndex(u => u.id == req.params.id && u.role === 'visitor');
  if (idx===-1) return res.status(404).json({ error: 'Non trouvé' });
  if (req.body.password) db.users[idx].password = req.body.password;
  if (req.body.name) db.users[idx].name = req.body.name;
  if (req.body.actif !== undefined) db.users[idx].actif = req.body.actif;
  writeDB(db); res.json({ visiteur: { ...db.users[idx], password: undefined } });
});
app.delete('/api/visiteurs/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); db.users = db.users.filter(u => !(u.id == req.params.id && u.role === 'visitor'));
  writeDB(db); res.json({ success: true });
});
app.get('/api/visiteur/data', requireAuth('visitor'), (req, res) => {
  const db = readDB();
  const visiteur = db.users.find(u => u.id === req.session.user.id);
  const actualites = db.actualites.filter(a => a.statut === 'publie').sort((a,b) => new Date(b.date) - new Date(a.date));
  const membres = db.users.filter(u => u.role === 'member' && u.statut === 'valide').map(m => ({ name: m.name, profession: m.profession, specialite: m.specialite, numero_ordre: m.numero_ordre }));
  const s = db.settings || {};
  res.json({ visiteur: { ...visiteur, password: undefined }, actualites, membres, settings: s });
});

// ---- INSCRIPTIONS (admin) ----
app.get('/api/inscriptions', requireAuth('admin'), (req, res) => {
  const db = readDB(); res.json({ inscriptions: db.inscriptions });
});
app.put('/api/inscriptions/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); const idx = db.inscriptions.findIndex(i => i.id == req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Non trouvé' });
  Object.assign(db.inscriptions[idx], req.body); writeDB(db); res.json({ inscription: db.inscriptions[idx] });
});
app.delete('/api/inscriptions/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); db.inscriptions = db.inscriptions.filter(i => i.id != req.params.id);
  writeDB(db); res.json({ success: true });
});

// ---- MESSAGES (admin) ----
app.get('/api/messages', requireAuth('admin'), (req, res) => {
  const db = readDB(); res.json({ messages: db.messages });
});
app.put('/api/messages/:id/lu', requireAuth('admin'), (req, res) => {
  const db = readDB(); const idx = db.messages.findIndex(m => m.id == req.params.id);
  if (idx===-1) return res.status(404).json({ error: 'Non trouvé' });
  db.messages[idx].lu = true; writeDB(db); res.json({ success: true });
});
app.delete('/api/messages/:id', requireAuth('admin'), (req, res) => {
  const db = readDB(); db.messages = db.messages.filter(m => m.id != req.params.id);
  writeDB(db); res.json({ success: true });
});

// ---- ANNuaire public ----
app.get('/api/annuaire', (req, res) => {
  const db = readDB();
  let membres = db.users.filter(u => u.role === 'member' && u.statut === 'valide');
  if (req.query.profession) membres = membres.filter(m => m.profession && m.profession.toLowerCase().includes(req.query.profession.toLowerCase()));
  if (req.query.specialite) membres = membres.filter(m => m.specialite && m.specialite.toLowerCase().includes(req.query.specialite.toLowerCase()));
  if (req.query.nom) membres = membres.filter(m => m.name && m.name.toLowerCase().includes(req.query.nom.toLowerCase()));
  res.json({ membres: membres.map(m => ({ name: m.name, profession: m.profession, specialite: m.specialite, numero_ordre: m.numero_ordre, email: m.email, telephone: m.phone })) });
});

// ---- STATS ----
app.get('/api/stats', requireAuth('admin'), (req, res) => {
  const db = readDB();
  res.json({ totalMembres: db.users.filter(u => u.role==='member').length, membresValides: db.users.filter(u => u.role==='member'&&u.statut==='valide').length, membresEnAttente: db.users.filter(u => u.role==='member'&&u.statut==='en_attente').length, totalActualites: db.actualites.length, totalInscriptions: db.inscriptions.length, inscriptionsEnAttente: db.inscriptions.filter(i => i.statut==='en_attente').length, messagesNonLus: db.messages.filter(m => !m.lu).length, totalVisiteurs: db.users.filter(u => u.role==='visitor').length });
});

// ---- MEMBER DATA ----
app.get('/api/member/data', requireAuth('member'), (req, res) => {
  const db = readDB();
  const membre = db.users.find(u => u.id === req.session.user.id);
  const actualites = db.actualites.filter(a => a.statut === 'publie');
  res.json({ membre: { ...membre, password: undefined }, actualites });
});

// ---- SETTINGS ----
app.get('/api/settings', requireAuth('admin'), (req, res) => {
  const db = readDB();
  res.json({ settings: db.settings || {} });
});

app.put('/api/settings', requireAuth('admin'), (req, res) => {
  const db = readDB();
  if (!db.settings) db.settings = {};
  Object.assign(db.settings, req.body);
  writeDB(db);
  res.json({ settings: db.settings });
});

app.put('/api/settings/tabs', requireAuth('admin'), (req, res) => {
  const db = readDB();
  if (!db.settings) db.settings = {};
  if (!db.settings.tabs_visibility) db.settings.tabs_visibility = {};
  Object.assign(db.settings.tabs_visibility, req.body);
  writeDB(db);
  res.json({ tabs_visibility: db.settings.tabs_visibility });
});

app.put('/api/settings/maintenance', requireAuth('admin'), (req, res) => {
  const db = readDB();
  if (!db.settings) db.settings = {};
  db.settings.maintenance_mode = req.body.maintenance_mode;
  if (req.body.maintenance_message_fr) db.settings.maintenance_message_fr = req.body.maintenance_message_fr;
  if (req.body.maintenance_message_ar) db.settings.maintenance_message_ar = req.body.maintenance_message_ar;
  writeDB(db);
  res.json({ maintenance_mode: db.settings.maintenance_mode });
});

app.get('/api/settings/public', (req, res) => {
  const db = readDB();
  const s = db.settings || {};
  res.json({
    maintenance_mode: s.maintenance_mode || false,
    maintenance_message_fr: s.maintenance_message_fr || '',
    maintenance_message_ar: s.maintenance_message_ar || '',
    tabs_visibility: s.tabs_visibility || {},
    site_name_fr: s.site_name_fr || '',
    site_name_ar: s.site_name_ar || '',
    header_text_fr: s.header_text_fr || '',
    header_text_ar: s.header_text_ar || '',
    footer_text_fr: s.footer_text_fr || '',
    footer_text_ar: s.footer_text_ar || '',
    contact_address_fr: s.contact_address_fr || '',
    contact_address_ar: s.contact_address_ar || '',
    contact_phone: s.contact_phone || '',
    contact_email: s.contact_email || '',
    contact_hours_fr: s.contact_hours_fr || '',
    contact_hours_ar: s.contact_hours_ar || '',
    hero_title_fr: s.hero_title_fr || '',
    hero_title_ar: s.hero_title_ar || '',
    hero_text_fr: s.hero_text_fr || '',
    hero_text_ar: s.hero_text_ar || '',
    logo_base64: s.logo_base64 || '',
    logo_type: s.logo_type || '',
    apropos_mission_title_fr: s.apropos_mission_title_fr || '',
    apropos_mission_title_ar: s.apropos_mission_title_ar || '',
    apropos_mission_text_fr: s.apropos_mission_text_fr || '',
    apropos_mission_text_ar: s.apropos_mission_text_ar || '',
    apropos_inscription_title_fr: s.apropos_inscription_title_fr || '',
    apropos_inscription_title_ar: s.apropos_inscription_title_ar || '',
    apropos_inscription_text_fr: s.apropos_inscription_text_fr || '',
    apropos_inscription_text_ar: s.apropos_inscription_text_ar || '',
    apropos_deonto_title_fr: s.apropos_deonto_title_fr || '',
    apropos_deonto_title_ar: s.apropos_deonto_title_ar || '',
    apropos_deonto_text_fr: s.apropos_deonto_text_fr || '',
    apropos_deonto_text_ar: s.apropos_deonto_text_ar || '',
    apropos_couverture_title_fr: s.apropos_couverture_title_fr || '',
    apropos_couverture_title_ar: s.apropos_couverture_title_ar || '',
    apropos_couverture_text_fr: s.apropos_couverture_text_fr || '',
    apropos_couverture_text_ar: s.apropos_couverture_text_ar || ''
  });
});

module.exports = app;
if (require.main === module || !isVercel) {
  app.listen(PORT, () => console.log(`ONPS Mauritanie - http://localhost:${PORT}`));
}
