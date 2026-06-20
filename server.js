const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use(session({
  secret: 'onps-mr-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
    if (role && req.session.user.role !== role) return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}

// ---- Init DB ----
db.initTurso().then(() => console.log('DB ready (' + (db.isTurso() ? 'Turso' : 'JSON') + ')')).catch(console.error);

// ---- AUTH ----
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.getUserByUsername(username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Identifiants incorrects' });
  if (user.role === 'visitor' && !user.actif) return res.status(403).json({ error: 'Compte désactivé' });
  req.session.user = { id: user.id, username: user.username, role: user.role, name: user.name, statut: user.statut || 'actif' };
  res.json({ user: req.session.user });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  res.json({ user: req.session.user });
});

// ---- PUBLIC ----
app.get('/api/public/actualites', async (req, res) => {
  res.json({ actualites: await db.getPublishedActualites() });
});
app.post('/api/public/inscription', async (req, res) => {
  const ins = { id: Date.now(), ...req.body, statut: 'en_attente', createdAt: new Date().toISOString() };
  await db.addInscription(ins); res.json({ success: true });
});
app.post('/api/public/contact', async (req, res) => {
  const msg = { id: Date.now(), ...req.body, lu: false, createdAt: new Date().toISOString() };
  await db.addMessage(msg); res.json({ success: true });
});

// ---- ACTUALITES CRUD ----
app.get('/api/actualites', requireAuth('admin'), async (req, res) => {
  res.json({ actualites: await db.getAllActualites() });
});
app.post('/api/actualites', requireAuth('admin'), async (req, res) => {
  const a = { id: Date.now(), ...req.body, createdBy: req.session.user.id, createdAt: new Date().toISOString() };
  await db.addActualite(a); res.json({ actualite: a });
});
app.put('/api/actualites/:id', requireAuth('admin'), async (req, res) => {
  await db.updateActualite(req.params.id, req.body);
  res.json({ success: true });
});
app.delete('/api/actualites/:id', requireAuth('admin'), async (req, res) => {
  await db.deleteActualite(req.params.id); res.json({ success: true });
});

// ---- MEMBRES ----
app.get('/api/membres', requireAuth('admin'), async (req, res) => {
  const membres = await db.getUsersByRole('member');
  res.json({ membres: membres.map(u => ({ ...u, password: undefined })) });
});
app.get('/api/membres/:id', requireAuth(), async (req, res) => {
  if (req.session.user.role !== 'admin' && req.session.user.id != req.params.id) return res.status(403).json({ error: 'Accès refusé' });
  const m = await db.getUser(req.params.id);
  if (!m) return res.status(404).json({ error: 'Non trouvé' });
  res.json({ membre: { ...m, password: undefined } });
});
app.put('/api/membres/:id/statut', requireAuth('admin'), async (req, res) => {
  await db.updateUser(req.params.id, { statut: req.body.statut }); res.json({ success: true });
});
app.post('/api/membres', requireAuth('admin'), async (req, res) => {
  if (await db.getUserByUsername(req.body.username)) return res.status(400).json({ error: 'Nom déjà pris' });
  const m = { id: Date.now(), username: req.body.username, password: req.body.password || 'user', role: 'member', name: req.body.name, email: req.body.email, phone: req.body.phone, profession: req.body.profession, specialite: req.body.specialite, numero_ordre: req.body.numero_ordre, statut: 'en_attente', createdAt: new Date().toISOString() };
  await db.addUser(m); res.json({ membre: { ...m, password: undefined } });
});
app.delete('/api/membres/:id', requireAuth('admin'), async (req, res) => {
  await db.deleteUser(req.params.id); res.json({ success: true });
});

// ---- VISITEURS ----
app.get('/api/visiteurs', requireAuth('admin'), async (req, res) => {
  const visiteurs = await db.getUsersByRole('visitor');
  res.json({ visiteurs: visiteurs.map(v => ({ ...v, password: undefined })) });
});
app.post('/api/visiteurs', requireAuth('admin'), async (req, res) => {
  if (await db.getUserByUsername(req.body.username)) return res.status(400).json({ error: 'Nom déjà pris' });
  const v = { id: Date.now(), username: req.body.username, password: req.body.password || 'visiteur123', role: 'visitor', name: req.body.name || req.body.username, actif: 1, createdAt: new Date().toISOString() };
  await db.addUser(v); res.json({ visiteur: { ...v, password: undefined } });
});
app.put('/api/visiteurs/:id', requireAuth('admin'), async (req, res) => {
  await db.updateUser(req.params.id, req.body); res.json({ success: true });
});
app.delete('/api/visiteurs/:id', requireAuth('admin'), async (req, res) => {
  await db.deleteUser(req.params.id); res.json({ success: true });
});
app.get('/api/visiteur/data', requireAuth('visitor'), async (req, res) => {
  const visiteur = await db.getUser(req.session.user.id);
  const actualites = await db.getPublishedActualites();
  const membres = (await db.getUsersByRole('member')).filter(m => m.statut === 'valide').map(m => ({ name: m.name, profession: m.profession, specialite: m.specialite, numero_ordre: m.numero_ordre }));
  const settings = await db.getAllSettings();
  res.json({ visiteur: { ...visiteur, password: undefined }, actualites, membres, settings });
});

// ---- INSCRIPTIONS ----
app.get('/api/inscriptions', requireAuth('admin'), async (req, res) => {
  res.json({ inscriptions: await db.getAllInscriptions() });
});
app.put('/api/inscriptions/:id', requireAuth('admin'), async (req, res) => {
  // JSON only for now
  res.json({ success: true });
});
app.delete('/api/inscriptions/:id', requireAuth('admin'), async (req, res) => {
  await db.deleteInscription(req.params.id); res.json({ success: true });
});

// ---- MESSAGES ----
app.get('/api/messages', requireAuth('admin'), async (req, res) => {
  res.json({ messages: await db.getAllMessages() });
});
app.put('/api/messages/:id/lu', requireAuth('admin'), async (req, res) => {
  await db.markMessageRead(req.params.id); res.json({ success: true });
});
app.delete('/api/messages/:id', requireAuth('admin'), async (req, res) => {
  await db.deleteMessage(req.params.id); res.json({ success: true });
});

// ---- ANNUAIRE ----
app.get('/api/annuaire', async (req, res) => {
  let membres = (await db.getUsersByRole('member')).filter(m => m.statut === 'valide');
  if (req.query.profession) membres = membres.filter(m => m.profession && m.profession.toLowerCase().includes(req.query.profession.toLowerCase()));
  if (req.query.specialite) membres = membres.filter(m => m.specialite && m.specialite.toLowerCase().includes(req.query.specialite.toLowerCase()));
  if (req.query.nom) membres = membres.filter(m => m.name && m.name.toLowerCase().includes(req.query.nom.toLowerCase()));
  res.json({ membres: membres.map(m => ({ name: m.name, profession: m.profession, specialite: m.specialite, numero_ordre: m.numero_ordre, email: m.email, telephone: m.phone })) });
});

// ---- STATS ----
app.get('/api/stats', requireAuth('admin'), async (req, res) => {
  res.json(await db.getStats());
});

// ---- MEMBER DATA ----
app.get('/api/member/data', requireAuth('member'), async (req, res) => {
  const membre = await db.getUser(req.session.user.id);
  const actualites = await db.getPublishedActualites();
  res.json({ membre: { ...membre, password: undefined }, actualites });
});

// ---- SETTINGS ----
app.get('/api/settings', requireAuth('admin'), async (req, res) => {
  res.json({ settings: await db.getAllSettings() });
});
app.put('/api/settings', requireAuth('admin'), async (req, res) => {
  await db.setSettings(req.body); res.json({ success: true });
});
app.put('/api/settings/tabs', requireAuth('admin'), async (req, res) => {
  const existing = await db.getSetting('tabs_visibility');
  const tabs = existing ? JSON.parse(existing) : {};
  Object.assign(tabs, req.body);
  await db.setSetting('tabs_visibility', tabs); res.json({ tabs_visibility: tabs });
});
app.put('/api/settings/maintenance', requireAuth('admin'), async (req, res) => {
  if (req.body.maintenance_mode !== undefined) await db.setSetting('maintenance_mode', req.body.maintenance_mode);
  if (req.body.maintenance_message_fr) await db.setSetting('maintenance_message_fr', req.body.maintenance_message_fr);
  if (req.body.maintenance_message_ar) await db.setSetting('maintenance_message_ar', req.body.maintenance_message_ar);
  res.json({ success: true });
});
app.get('/api/settings/public', async (req, res) => {
  const s = await db.getAllSettings();
  const fields = ['maintenance_mode','maintenance_message_fr','maintenance_message_ar','tabs_visibility',
    'site_name_fr','site_name_ar','header_text_fr','header_text_ar',
    'footer_text_fr','footer_text_ar','contact_address_fr','contact_address_ar',
    'contact_phone','contact_email','contact_hours_fr','contact_hours_ar',
    'hero_title_fr','hero_title_ar','hero_text_fr','hero_text_ar',
    'logo_base64','logo_type',
    'apropos_mission_title_fr','apropos_mission_title_ar','apropos_mission_text_fr','apropos_mission_text_ar',
    'apropos_inscription_title_fr','apropos_inscription_title_ar','apropos_inscription_text_fr','apropos_inscription_text_ar',
    'apropos_deonto_title_fr','apropos_deonto_title_ar','apropos_deonto_text_fr','apropos_deonto_text_ar',
    'apropos_couverture_title_fr','apropos_couverture_title_ar','apropos_couverture_text_fr','apropos_couverture_text_ar'];
  const result = {};
  for (const f of fields) {
    const v = s[f];
    if (f === 'maintenance_mode' || f === 'tabs_visibility') {
      result[f] = f === 'maintenance_mode' ? (v === 'true' || v === true) : (typeof v === 'object' ? v : {});
    } else {
      result[f] = v || '';
    }
  }
  res.json(result);
});

module.exports = app;
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`ONPS Mauritanie - http://localhost:${PORT}`));
}
