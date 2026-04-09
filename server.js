'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const newsCollector = require('./news/news-collector');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'kidsboard.db');
const DB_BUCKET = process.env.DB_BUCKET || 'kidsboard-db-bucket';
const LOCAL_DB = '/tmp/kidsboard.db';
let gcsBucket = null;
let gcsFile = null;
let backupTimer = null;

function scheduleBackup() {
  if (!gcsFile) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(async () => {
    try {
      console.log('Backing up DB to Cloud Storage...');
      await gcsFile.save(fs.readFileSync(LOCAL_DB));
      console.log('DB backup successful.');
    } catch (e) {
      console.error('DB backup failed:', e);
    }
  }, 5000);
}

(async () => {
  if (process.env.K_SERVICE) {
    try {
      const { Storage } = require('@google-cloud/storage');
      const storage = new Storage();
      gcsBucket = storage.bucket(DB_BUCKET);
      gcsFile = gcsBucket.file('kidsboard.db');

      const [exists] = await gcsFile.exists();
      if (exists) {
        console.log('Restoring DB from GCS...');
        await gcsFile.download({ destination: LOCAL_DB });
        console.log('DB restored from GCS to', LOCAL_DB);
      } else {
        console.log('No DB found in GCS, starting fresh.');
      }
      console.log('GCS backup enabled');
    } catch (e) {
      console.error('GCS setup failed:', e);
    }
  }

  const db = new sqlite3.Database(process.env.K_SERVICE ? LOCAL_DB : DB_PATH);

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grade INTEGER,
      gender TEXT,
      school TEXT,
      birth_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER,
      day_of_week INTEGER, 
      start_time TEXT,
      end_time TEXT,
      title TEXT NOT NULL,
      category TEXT,
      color TEXT,
      location TEXT,
      teacher TEXT,
      recurring BOOLEAN
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER,
      title TEXT NOT NULL,
      date DATE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS homeworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER,
      subject TEXT,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATE,
      priority INTEGER DEFAULT 2, 
      status TEXT DEFAULT 'pending', 
      photo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS supplies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_id INTEGER,
        date DATE NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT,
        is_checked BOOLEAN DEFAULT 0,
        recurring BOOLEAN DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS news_bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        source TEXT,
        summary TEXT,
        tags TEXT, 
        age_group TEXT, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  });

  app.get('/api/children', (req, res) => db.all('SELECT * FROM children', (err, r) => res.json(r)));
  app.post('/api/children', (req, res) => {
    const { name, grade, gender, school, birth_date } = req.body;
    db.run('INSERT INTO children (name, grade, gender, school, birth_date) VALUES (?,?,?,?,?)', [name, grade, gender, school, birth_date], function(err) { res.json({ id: this.lastID }); scheduleBackup(); });
  });
  app.put('/api/children/:id', (req, res) => {
    const { name, grade, gender, school, birth_date } = req.body;
    db.run('UPDATE children SET name=?, grade=?, gender=?, school=?, birth_date=? WHERE id=?', [name, grade, gender, school, birth_date, req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); });
  });
  app.delete('/api/children/:id', (req, res) => {
    const childId = req.params.id;
    db.run('DELETE FROM schedules WHERE child_id=?', [childId], () => {
      db.run('DELETE FROM events WHERE child_id=?', [childId], () => {
        db.run('DELETE FROM supplies WHERE child_id=?', [childId], () => {
          db.run('DELETE FROM homeworks WHERE child_id=?', [childId], () => {
            db.run('DELETE FROM children WHERE id=?', [childId], function(err) {
              if (err) return res.status(500).json({ error: err.message });
              if (this.changes === 0) return res.status(404).json({ error: 'Child not found' });
              res.json({ ok: 1 }); scheduleBackup();
            });
          });
        });
      });
    });
  });

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
      res.json({ id: this.lastID }); scheduleBackup();
    });
  });
  app.put('/api/events/:id', (req, res) => {
    const { title, date, description } = req.body;
    db.run('UPDATE events SET title=?, date=?, description=? WHERE id=?', [title, date, description, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: 1 }); scheduleBackup();
    });
  });
  app.delete('/api/events/:id', (req, res) => {
    db.run('DELETE FROM events WHERE id=?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: 1 }); scheduleBackup();
    });
  });

  app.get('/api/schedules/:childId', (req, res) => db.all('SELECT * FROM schedules WHERE child_id=?', [req.params.childId], (err, r) => res.json(r)));
  app.post('/api/schedules', (req, res) => {
    const { child_id, day_of_week, start_time, end_time, title, category, color, location, teacher, recurring } = req.body;
    db.run('INSERT INTO schedules (child_id, day_of_week, start_time, end_time, title, category, color, location, teacher, recurring) VALUES (?,?,?,?,?,?,?,?,?,?)', [child_id, day_of_week, start_time, end_time, title, category, color, location, teacher, recurring ? 1 : 0], function(err) { res.json({ id: this.lastID }); scheduleBackup(); });
  });
  app.put('/api/schedules/:id', (req, res) => {
    const { day_of_week, start_time, end_time, title, category, color, location, teacher, recurring } = req.body;
    db.run('UPDATE schedules SET day_of_week=?, start_time=?, end_time=?, title=?, category=?, color=?, location=?, teacher=?, recurring=? WHERE id=?', [day_of_week, start_time, end_time, title, category, color, location, teacher, recurring ? 1 : 0, req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); });
  });
  app.delete('/api/schedules/:id', (req, res) => db.run('DELETE FROM schedules WHERE id=?', [req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); }));

  app.get('/api/homeworks/:childId', (req, res) => db.all('SELECT * FROM homeworks WHERE child_id=?', [req.params.childId], (err, r) => res.json(r)));
  app.post('/api/homeworks', (req, res) => {
    const { child_id, subject, title, description, due_date, priority } = req.body;
    db.run('INSERT INTO homeworks (child_id, subject, title, description, due_date, priority) VALUES (?,?,?,?,?,?)', [child_id, subject, title, description, due_date, priority], function(err) { res.json({ id: this.lastID }); scheduleBackup(); });
  });
  app.put('/api/homeworks/:id', (req, res) => {
    const { status, subject, title, description, due_date, priority } = req.body;
    db.run('UPDATE homeworks SET status=?, subject=?, title=?, description=?, due_date=?, priority=? WHERE id=?', [status, subject, title, description, due_date, priority, req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); });
  });
  app.delete('/api/homeworks/:id', (req, res) => db.run('DELETE FROM homeworks WHERE id=?', [req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); }));

  app.get('/api/supplies/:childId/:date', (req, res) => db.all('SELECT * FROM supplies WHERE child_id=? AND date=?', [req.params.childId, req.params.date], (err, r) => res.json(r)));
  app.post('/api/supplies', (req, res) => {
    const { child_id, date, item_name, category, recurring } = req.body;
    console.log('POST /api/supplies:', { child_id, date, item_name, category });
    if (!child_id) return res.status(400).json({ error: 'child_id is required' });
    db.run('INSERT INTO supplies (child_id, date, item_name, category, recurring) VALUES (?,?,?,?,?)', [child_id, date, item_name, category, recurring ? 1 : 0], function(err) {
      if (err) { console.error('Supplies insert error:', err); return res.status(500).json({ error: err.message }); }
      res.json({ id: this.lastID }); scheduleBackup();
    });
  });
  app.put('/api/supplies/:id', (req, res) => {
    const { item_name, date, category, is_checked } = req.body;
    db.get('SELECT * FROM supplies WHERE id=?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Not found' });
      const newName = item_name !== undefined ? item_name : row.item_name;
      const newDate = date !== undefined ? date : row.date;
      const newCat = category !== undefined ? category : row.category;
      const newChecked = is_checked !== undefined ? (is_checked ? 1 : 0) : row.is_checked;
      db.run('UPDATE supplies SET item_name=?, date=?, category=?, is_checked=? WHERE id=?', [newName, newDate, newCat, newChecked, req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); });
    });
  });
  app.delete('/api/supplies/:id', (req, res) => db.run('DELETE FROM supplies WHERE id=?', [req.params.id], () => { res.json({ ok: 1 }); scheduleBackup(); }));

  app.get('/api/news', (req, res) => {
    db.all('SELECT * FROM news_bookmarks ORDER BY id DESC LIMIT 12', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.get('/api/news/keywords', (req, res) => {
    db.get("SELECT value FROM settings WHERE key='news_keywords'", [], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ keywords: row ? row.value : '' });
    });
  });
  app.post('/api/news/keywords', (req, res) => {
    const { keywords } = req.body;
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('news_keywords', ?)", [keywords || ''], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
      scheduleBackup();
    });
  });

  app.get('/api/news/redirect', async (req, res) => {
      const url = req.query.url;
      if (!url) return res.status(400).send('URL is required');
      
      try {
          const finalUrl = await newsCollector.followRedirects(url);
          res.redirect(finalUrl);
      } catch (e) {
          res.status(500).send('Failed to follow redirect');
      }
  });

  app.get('/api/summary/:childId?', async (req, res) => {
    const childId = req.params.childId;
    const today = req.query.today || new Date().toISOString().split('T')[0];

    const results = {};
    const p1 = new Promise(res => db.all('SELECT * FROM children ORDER BY created_at', [], (err, r) => res(r || [])));

    const children = await p1;
    results.children = children;

    const activeId = childId || (children[0] ? children[0].id : null);
    if (activeId) {
      const p3 = new Promise(res => db.all('SELECT * FROM schedules WHERE child_id=? ORDER BY day_of_week, start_time', [activeId], (err, r) => res(r || [])));
      const p4 = new Promise(res => db.all('SELECT * FROM homeworks WHERE child_id=? AND status="pending" ORDER BY priority, due_date', [activeId], (err, r) => res(r || [])));
      const p5 = new Promise(res => db.all('SELECT * FROM supplies WHERE child_id=? ORDER BY date DESC, category', [activeId], (err, r) => res(r || [])));
      const p6 = new Promise(res => db.all('SELECT * FROM events WHERE child_id=? ORDER BY date ASC', [activeId], (err, r) => res(r || [])));

      const [schedules, homeworks, supplies, events] = await Promise.all([p3, p4, p5, p6]);
      results.schedules = schedules;
      results.homeworks = homeworks;
      results.supplies = supplies;
      results.events = events;
    }
    res.json(results);
  });

  app.listen(PORT, () => {
    console.log(`KidsBoard server running on http://localhost:${PORT}`);
    setTimeout(() => { newsCollector.collectAndClassifyNews(db).catch(e => console.error(e)); }, 1000);
  });
})();
