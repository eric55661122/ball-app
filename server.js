const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URI,
  ssl: process.env.POSTGRES_URI && process.env.POSTGRES_URI.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_data (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, key)
    );
    CREATE TABLE IF NOT EXISTS passwords (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      site TEXT NOT NULL,
      account TEXT NOT NULL,
      password TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token expired' }); }
}

// ─── Auth ────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '請填寫帳號和密碼' });
  const { rows } = await pool.query('SELECT COUNT(*) c FROM users');
  if (parseInt(rows[0].c) > 0) return res.status(403).json({ error: '系統已初始化，請聯繫管理員' });
  try {
    await pool.query('INSERT INTO users (username,password) VALUES ($1,$2)', [username, bcrypt.hashSync(password, 10)]);
    res.json({ ok: true });
  } catch { res.status(400).json({ error: '帳號已存在' }); }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, username: user.username, token });
});

app.post('/api/logout', (req, res) => res.json({ ok: true }));

app.get('/api/check-init', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) c FROM users');
  res.json({ initialized: parseInt(rows[0].c) > 0 });
});

app.get('/api/me', auth, (req, res) => res.json({ username: req.user.username }));

app.post('/api/change-password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!bcrypt.compareSync(oldPassword, rows[0].password))
    return res.status(400).json({ error: '舊密碼錯誤' });
  await pool.query('UPDATE users SET password=$1 WHERE id=$2', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  res.json({ ok: true });
});

// Emergency reset - protected by RESET_SECRET env var
app.post('/api/reset-password', async (req, res) => {
  const { secret, username, newPassword } = req.body;
  const resetSecret = process.env.RESET_SECRET;
  if (!resetSecret || secret !== resetSecret)
    return res.status(403).json({ error: 'Invalid secret' });
  const hashed = bcrypt.hashSync(newPassword, 10);
  const result = await pool.query(
    'UPDATE users SET password=$1 WHERE username=$2 RETURNING id', [hashed, username]
  );
  if (result.rows.length === 0) {
    // List all users to help identify the account
    const all = await pool.query('SELECT username FROM users');
    return res.status(404).json({ error: 'User not found', existing_users: all.rows.map(r => r.username) });
  }
  res.json({ ok: true, message: 'Password reset successfully' });
});

// ─── App data ────────────────────────────────────────────────
app.get('/api/data', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT value FROM app_data WHERE user_id=$1 AND key=$2', [req.user.id, 'main']);
  res.json({ data: rows[0] ? JSON.parse(rows[0].value) : null });
});

app.post('/api/data', auth, async (req, res) => {
  await pool.query(`
    INSERT INTO app_data (user_id,key,value,updated_at) VALUES ($1,'main',$2,NOW())
    ON CONFLICT (user_id,key) DO UPDATE SET value=$2, updated_at=NOW()
  `, [req.user.id, JSON.stringify(req.body.data)]);
  res.json({ ok: true });
});

// ─── Password manager ────────────────────────────────────────
app.get('/api/passwords', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM passwords WHERE user_id=$1 ORDER BY id DESC', [req.user.id]);
  res.json(rows);
});

app.post('/api/passwords', auth, async (req, res) => {
  const { site, account, password, note } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO passwords (user_id,site,account,password,note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.user.id, site, account, password, note || '']
  );
  res.json({ id: rows[0].id });
});

app.delete('/api/passwords/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM passwords WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ─── Export / Import ─────────────────────────────────────────
app.get('/api/export', auth, async (req, res) => {
  const { rows: d } = await pool.query('SELECT value FROM app_data WHERE user_id=$1 AND key=$2', [req.user.id, 'main']);
  const { rows: p } = await pool.query('SELECT site,account,password,note FROM passwords WHERE user_id=$1', [req.user.id]);
  res.setHeader('Content-Disposition', `attachment; filename="ball-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.json({ ballDB: d[0] ? JSON.parse(d[0].value) : null, passwords: p, exportedAt: new Date().toISOString() });
});

app.post('/api/import', auth, async (req, res) => {
  const { ballDB, passwords } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ballDB) await client.query(`
      INSERT INTO app_data (user_id,key,value,updated_at) VALUES ($1,'main',$2,NOW())
      ON CONFLICT (user_id,key) DO UPDATE SET value=$2, updated_at=NOW()
    `, [req.user.id, JSON.stringify(ballDB)]);
    if (Array.isArray(passwords)) {
      await client.query('DELETE FROM passwords WHERE user_id=$1', [req.user.id]);
      for (const p of passwords)
        await client.query('INSERT INTO passwords (user_id,site,account,password,note) VALUES ($1,$2,$3,$4,$5)',
          [req.user.id, p.site, p.account, p.password, p.note || '']);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB()
  .then(() => app.listen(PORT, () => console.log(`Ball App on port ${PORT}`)))
  .catch(e => { console.error('DB init failed:', e); process.exit(1); });
