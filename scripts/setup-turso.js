const { createClient } = require('@tursodatabase/api');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('=== Configuration Turso pour ONPS Mauritanie ===\n');
  
  // Check if already configured
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    console.log('✅ Variables Turso déjà configurées dans l\'environnement');
    console.log(`   URL: ${process.env.TURSO_DATABASE_URL}`);
    const { createClient } = require('@libsql/client');
    const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    try {
      await c.execute('SELECT 1');
      console.log('✅ Connexion Turso réussie !');
    } catch(e) {
      console.log('❌ Connexion échouée:', e.message);
    }
    return;
  }

  console.log('Vous avez besoin d\'un compte Turso (gratuit) pour activer la persistance des données.\n');
  console.log('Étapes :');
  console.log('1. Allez sur https://turso.tech et créez un compte (via GitHub)');
  console.log('2. Depuis le dashboard, créez un nouveau Token API :');
  console.log('   Settings → API Tokens → Create token');
  console.log('3. Copiez les informations suivantes :');
  console.log('   - Organization slug (ex: mon-org)');
  console.log('   - API Token\n');
  console.log('4. Exécutez ce script avec :');
  console.log('   node scripts/setup-turso.js <org-slug> <api-token>\n');

  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.exit(0);
  }

  const [org, token] = args;
  console.log(`Création de la base de données pour l'organisation "${org}"...`);

  const turso = createClient({ org, token });

  // Check if group exists, create if not
  let groups;
  try {
    groups = await turso.groups.list();
  } catch(e) {
    console.log('❌ Erreur d\'authentification. Vérifiez votre token et organisation.');
    console.log(e.message);
    process.exit(1);
  }

  const groupName = 'default';
  const groupExists = groups.some(g => g.name === groupName);
  if (!groupExists) {
    console.log('Création du groupe "default"...');
    await turso.groups.create(groupName, { location: 'lhr' });
  }

  // Create database
  const dbName = 'onps-mauritanie';
  let db;
  try {
    db = await turso.databases.create(dbName, { group: groupName });
    console.log(`✅ Base de données "${dbName}" créée !`);
  } catch(e) {
    if (e.message.includes('already exists')) {
      console.log(`ℹ️ Base "${dbName}" existe déjà, récupération...`);
      db = await turso.databases.get(dbName);
    } else {
      throw e;
    }
  }

  // Generate auth token for the database
  const { jwt } = await turso.databases.createToken(dbName);
  
  const databaseUrl = `libsql://${db.hostname}`;
  
  console.log('\n✅ Informations de connexion :');
  console.log(`   TURSO_DATABASE_URL=${databaseUrl}`);
  console.log(`   TURSO_AUTH_TOKEN=${jwt}`);
  console.log(`   TURSO_ORG=${org}`);
  console.log(`   TURSO_PLATFORM_TOKEN=${token}`);

  console.log('\nAjoutez ces variables sur Vercel :');
  console.log(`vercel env add TURSO_DATABASE_URL`);
  console.log(`vercel env add TURSO_AUTH_TOKEN`);

  // Write to .env.local for local testing
  const envContent = `TURSO_DATABASE_URL=${databaseUrl}\nTURSO_AUTH_TOKEN=${jwt}\nTURSO_ORG=${org}\nTURSO_PLATFORM_TOKEN=${token}\n`;
  fs.writeFileSync(path.join(__dirname, '..', '.env.local'), envContent);
  console.log('\n✅ Fichier .env.local créé pour les tests locaux');
}

main().catch(console.error);
