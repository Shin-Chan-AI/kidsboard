const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const newsCollector = require('./news/news-collector');
const parentingExpert = require('./news/parenting-expert');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'kidsboard.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run('PRAGMA journal_mode=DELETE');
  db.run('PRAGMA synchronous=OFF');

  db.run(`CREATE TABLE IF NOT EXISTS children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade INTEGER,
    gender TEXT DEFAULT 'girl',
    school TEXT,
    birth_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    title TEXT NOT NULL,
    category TEXT,
    color TEXT,
    location TEXT,
    teacher TEXT,
    recurring BOOLEAN DEFAULT 1,
    FOREIGN KEY (child_id) REFERENCES children(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS homeworks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE NOT NULL,
    priority INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pending',
    photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES children(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES children(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS supplies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    date DATE NOT NULL,
    item_name TEXT NOT NULL,
    category TEXT,
    is_checked BOOLEAN DEFAULT 0,
    recurring BOOLEAN DEFAULT 0,
    FOREIGN KEY (child_id) REFERENCES children(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS news_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT UNIQUE,
    source TEXT,
    summary TEXT,
    tags TEXT,
    age_group TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE children ADD COLUMN gender TEXT DEFAULT 'girl'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) console.error(err);
  });
});

// === Dashboard Summary API (Optimized version moved to bottom) ===

// === Children API (Omitted for brevity, kept essential) ===
app.get('/api/children', (req,res)=> db.all('SELECT * FROM children', (err,r)=>res.json(r)));
app.post('/api/children', (req,res)=> {
  const {name, grade, gender, school, birth_date} = req.body;
  db.run('INSERT INTO children (name, grade, gender, school, birth_date) VALUES (?,?,?,?,?)', [name, grade, gender, school, birth_date], function(err){res.json({id:this.lastID})});
});
app.put('/api/children/:id', (req,res)=> {
  const {name, grade, gender, school, birth_date} = req.body;
  db.run('UPDATE children SET name=?, grade=?, gender=?, school=?, birth_date=? WHERE id=?', [name, grade, gender, school, birth_date, req.params.id], ()=>res.json({ok:1}));
});
app.delete('/api/children/:id', (req,res)=> db.run('DELETE FROM children WHERE id=?', [req.params.id], ()=>res.json({ok:1})));

// === Events API ===
app.get('/api/events/:childId', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.all('SELECT * FROM events WHERE child_id=? AND date >= ? ORDER BY date ASC', [req.params.childId, today], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.post('/api/events', (req, res) => {
  const { child_id, title, date, description } = req.body;
  db.run('INSERT INTO events (child_id, title, date, description) VALUES (?, ?, ?, ?)', [child_id, title, date, description], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});
app.put('/api/events/:id', (req, res) => {
  const { title, date, description } = req.body;
  db.run('UPDATE events SET title=?, date=?, description=? WHERE id=?', [title, date, description, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: 1 });
  });
});
app.delete('/api/events/:id', (req, res) => {
  db.run('DELETE FROM events WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: 1 });
  });
});

// === Others (Omitted but functional) ===
app.get('/api/schedules/:childId', (req,res)=> db.all('SELECT * FROM schedules WHERE child_id=?', [req.params.childId], (err,r)=>res.json(r)));
app.post('/api/schedules', (req,res)=> {
  const {child_id, day_of_week, start_time, end_time, title, category, color, location, teacher, recurring} = req.body;
  db.run('INSERT INTO schedules (child_id, day_of_week, start_time, end_time, title, category, color, location, teacher, recurring) VALUES (?,?,?,?,?,?,?,?,?,?)', [child_id, day_of_week, start_time, end_time, title, category, color, location, teacher, recurring?1:0], function(err){res.json({id:this.lastID})});
});
app.put('/api/schedules/:id', (req,res)=> {
  const {day_of_week, start_time, end_time, title, category, color, location, teacher, recurring} = req.body;
  db.run('UPDATE schedules SET day_of_week=?, start_time=?, end_time=?, title=?, category=?, color=?, location=?, teacher=?, recurring=? WHERE id=?', [day_of_week, start_time, end_time, title, category, color, location, teacher, recurring?1:0, req.params.id], ()=>res.json({ok:1}));
});
app.delete('/api/schedules/:id', (req,res)=> db.run('DELETE FROM schedules WHERE id=?', [req.params.id], ()=>res.json({ok:1})));

app.get('/api/homeworks/:childId', (req,res)=> db.all('SELECT * FROM homeworks WHERE child_id=?', [req.params.childId], (err,r)=>res.json(r)));
app.post('/api/homeworks', (req,res)=> {
  const {child_id, subject, title, description, due_date, priority} = req.body;
  db.run('INSERT INTO homeworks (child_id, subject, title, description, due_date, priority) VALUES (?,?,?,?,?,?)', [child_id, subject, title, description, due_date, priority], function(err){res.json({id:this.lastID})});
});
app.put('/api/homeworks/:id', (req,res)=> {
  const {status, subject, title, description, due_date, priority} = req.body;
  db.run('UPDATE homeworks SET status=?, subject=?, title=?, description=?, due_date=?, priority=? WHERE id=?', [status, subject, title, description, due_date, priority, req.params.id], ()=>res.json({ok:1}));
});
app.delete('/api/homeworks/:id', (req,res)=> db.run('DELETE FROM homeworks WHERE id=?', [req.params.id], ()=>res.json({ok:1})));

app.get('/api/supplies/:childId/:date', (req,res)=> db.all('SELECT * FROM supplies WHERE child_id=? AND date=?', [req.params.childId, req.params.date], (err,r)=>res.json(r)));
app.post('/api/supplies', (req,res)=> {
  const {child_id, date, item_name, category, recurring} = req.body;
  db.run('INSERT INTO supplies (child_id, date, item_name, category, recurring) VALUES (?,?,?,?,?)', [child_id, date, item_name, category, recurring?1:0], function(err){res.json({id:this.lastID})});
});
app.put('/api/supplies/:id', (req,res)=> db.run('UPDATE supplies SET is_checked=? WHERE id=?', [req.body.is_checked?1:0, req.params.id], ()=>res.json({ok:1})));
app.delete('/api/supplies/:id', (req,res)=> db.run('DELETE FROM supplies WHERE id=?', [req.params.id], ()=>res.json({ok:1})));

app.get('/api/news', (req, res) => {
  const { tags } = req.query;
  let query = 'SELECT * FROM news_bookmarks';
  let params = [];
  if (tags) {
    query += ' WHERE tags LIKE ?';
    params.push(`%${tags}%`);
  }
  query += ' ORDER BY id DESC LIMIT 12';
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get('/api/summary/:childId?', async (req, res) => {
  const childId = req.params.childId;
  // 한국 시간(KST) 기준 날짜 계산
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const today = kst.toISOString().split('T')[0];
  
  const results = {};
  const p1 = new Promise(res => db.all('SELECT * FROM children ORDER BY created_at', [], (err, r) => res(r||[])));
  const p2 = new Promise(res => db.all('SELECT * FROM news_bookmarks ORDER BY id DESC LIMIT 6', [], (err, r) => res(r||[])));
  
  const [children, news] = await Promise.all([p1, p2]);
  results.children = children;
  results.news = news;
  
  const activeId = childId || (children[0] ? children[0].id : null);
  if (activeId) {
    const p3 = new Promise(res => db.all('SELECT * FROM schedules WHERE child_id=? ORDER BY day_of_week, start_time', [activeId], (err, r) => res(r||[])));
    const p4 = new Promise(res => db.all('SELECT * FROM homeworks WHERE child_id=? AND status="pending" ORDER BY priority, due_date', [activeId], (err, r) => res(r||[])));
    const p5 = new Promise(res => db.all('SELECT * FROM supplies WHERE child_id=? AND date=? ORDER BY category', [activeId, today], (err, r) => res(r||[])));
    const p6 = new Promise(res => db.all('SELECT * FROM events WHERE child_id=? AND date >= ? ORDER BY date ASC LIMIT 5', [activeId, today], (err, r) => res(r||[])));
    
    const [schedules, homeworks, supplies, events] = await Promise.all([p3, p4, p5, p6]);
    results.schedules = schedules;
    results.homeworks = homeworks;
    results.supplies = supplies;
    results.events = events;
  }
  res.json(results);
});

app.get('/api/advice/:childId', async (req, res) => {
  const childId = req.params.childId;
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const today = kst.toISOString().split('T')[0];

  const p_child = new Promise(res => db.get('SELECT * FROM children WHERE id=?', [childId], (err, r) => res(r)));
  const p_sch = new Promise(res => db.all('SELECT * FROM schedules WHERE child_id=?', [childId], (err, r) => res(r||[])));
  const p_hw = new Promise(res => db.all('SELECT * FROM homeworks WHERE child_id=? AND status="pending"', [childId], (err, r) => res(r||[])));
  const p_sup = new Promise(res => db.all('SELECT * FROM supplies WHERE child_id=? AND date=?', [childId, today], (err, r) => res(r||[])));
  const p_ev = new Promise(res => db.all('SELECT * FROM events WHERE child_id=? AND date >= ? ORDER BY date ASC LIMIT 3', [childId, today], (err, r) => res(r||[])));

  const [child, schedules, homeworks, supplies, events] = await Promise.all([p_child, p_sch, p_hw, p_sup, p_ev]);

  if (!child) return res.status(404).json({ error: 'Child not found' });

  const advice = await parentingExpert.getParentingAdvice({
    ...child, schedules, homeworks, supplies, events
  });

  res.json({ advice });
});

app.get('/api/news/refresh', async (req, res) => {
  try { 
    await newsCollector.collectAndClassifyNews(db); 
    res.json({ success: true }); 
  } catch (err) { 
    console.error('News Refresh Error:', err);
    res.status(500).json({ success: false, error: err.message }); 
  }
});

app.listen(PORT, () => {
  console.log(`KidsBoard server running on http://localhost:${PORT}`);
  setTimeout(() => { newsCollector.collectAndClassifyNews(db).catch(e => console.error(e)); }, 1000);
});
