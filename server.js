'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const newsCollector = require('./news/news-collector');

// --- DEBUG: Print all environment variables ---
console.log(JSON.stringify(process.env, null, 2));
// ----------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// API 응답 캐시 방지
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'kidsboard.db');
const DB_BUCKET = process.env.DB_BUCKET;
const DB_FILE = process.env.DB_FILE || 'kidsboard.db';
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
  // Cloud Storage 기능 조건부 활성화
  if (process.env.K_SERVICE && DB_BUCKET && process.env.USE_GCS !== 'false') {
    try {
      // 모듈이 없을 수 있으므로 동적으로 require
      const { Storage } = require('@google-cloud/storage');
      const storage = new Storage();
      gcsBucket = storage.bucket(DB_BUCKET);
      gcsFile = gcsBucket.file(DB_FILE);

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
      console.error('GCS setup failed, falling back to local DB:', e.message);
      console.log('Continuing with local database only.');
    }
  } else {
    console.log('GCS backup disabled (K_SERVICE or DB_BUCKET not set, or USE_GCS=false).');
  }

  const db = new sqlite3.Database(process.env.K_SERVICE ? LOCAL_DB : DB_PATH);

  // 테이블이 이미 존재한다고 가정 (kidsboard.db에 이미 테이블 있음)
  console.log('Database connected, tables should already exist');

  // 테이블 생성 (존재하지 않을 경우)
  db.serialize(() => {
    // children 테이블
    db.run(`CREATE TABLE IF NOT EXISTS children (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      grade INTEGER,
      gender TEXT,
      school TEXT,
      birth_date DATE,
      created_at DATETIME
    )`);
    
    // schedules 테이블
    db.run(`CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY,
      child_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      title TEXT NOT NULL,
      category TEXT,
      color TEXT,
      location TEXT,
      teacher TEXT,
      recurring BOOLEAN
    )`);
    
    // homeworks 테이블
    db.run(`CREATE TABLE IF NOT EXISTS homeworks (
      id INTEGER PRIMARY KEY,
      child_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATE NOT NULL,
      priority INTEGER,
      status TEXT,
      photo_url TEXT,
      created_at DATETIME
    )`);
    
    // events 테이블
    db.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      child_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      date DATE NOT NULL,
      description TEXT,
      created_at DATETIME
    )`);
    
    // supplies 테이블
    db.run(`CREATE TABLE IF NOT EXISTS supplies (
      id INTEGER PRIMARY KEY,
      child_id INTEGER NOT NULL,
      date DATE NOT NULL,
      item_name TEXT NOT NULL,
      category TEXT,
      is_checked BOOLEAN,
      recurring BOOLEAN
    )`);
    
    // news_bookmarks 테이블
    db.run(`CREATE TABLE IF NOT EXISTS news_bookmarks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT,
      summary TEXT,
      tags TEXT,
      age_group TEXT,
      created_at DATETIME
    )`);
    
    // settings 테이블
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
    
    console.log('Tables created or already exist');
  });

  // ============ API Routes ============

  // 기본 API 엔드포인트
  app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'KidsBoard server is running' });
  });

  // children 테이블 API
  app.get('/api/children', (req, res) => {
    db.all('SELECT * FROM children ORDER BY name', (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });

  // schedules 테이블 API
  app.get('/api/schedules', (req, res) => {
    const childId = req.query.child_id;
    let query = 'SELECT * FROM schedules';
    const params = [];
    
    if (childId) {
      query += ' WHERE child_id = ?';
      params.push(childId);
    }
    
    query += ' ORDER BY day_of_week, start_time';
    
    db.all(query, params, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });

  // homeworks 테이블 API  
  app.get('/api/homeworks', (req, res) => {
    const childId = req.query.child_id;
    let query = 'SELECT * FROM homeworks';
    const params = [];
    
    if (childId) {
      query += ' WHERE child_id = ?';
      params.push(childId);
    }
    
    query += ' ORDER BY due_date';
    
    db.all(query, params, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });

  // events 테이블 API
  app.get('/api/events', (req, res) => {
    const childId = req.query.child_id;
    let query = 'SELECT * FROM events';
    const params = [];
    
    if (childId) {
      query += ' WHERE child_id = ?';
      params.push(childId);
    }
    
    query += ' ORDER BY date';
    
    db.all(query, params, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });

  // supplies 테이블 API
  app.get('/api/supplies', (req, res) => {
    const childId = req.query.child_id;
    let query = 'SELECT * FROM supplies';
    const params = [];
    
    if (childId) {
      query += ' WHERE child_id = ?';
      params.push(childId);
    }
    
    query += ' ORDER BY date';
    
    db.all(query, params, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });

  // news_bookmarks 테이블 API
  app.get('/api/news', (req, res) => {
    db.all('SELECT * FROM news_bookmarks ORDER BY created_at DESC', (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  });

  // 뉴스 새로고침 API
  app.post('/api/news/refresh', async (req, res) => {
    try {
      console.log('Manual news refresh requested');
      await newsCollector.collectAndClassifyNews(db);
      res.json({ message: 'News refreshed successfully' });
    } catch (error) {
      console.error('News refresh error:', error);
      res.status(500).json({ error: 'Failed to refresh news' });
    }
  });

  // 뉴스 키워드 관리 API
  app.get('/api/news/keywords', (req, res) => {
    // 임시 구현 - 설정 테이블이 없으므로 기본값 반환
    res.json({ keywords: '초등 교육 정보,육아 팁,학습 가이드' });
  });

  app.post('/api/news/keywords', (req, res) => {
    // 임시 구현 - 실제로는 설정 테이블에 저장
    console.log('News keywords updated:', req.body);
    res.json({ message: 'Keywords updated successfully' });
  });

  // 샘플 데이터 확인 엔드포인트
  app.get('/api/check-data', (req, res) => {
    const tables = ['children', 'schedules', 'homeworks', 'events', 'supplies', 'news_bookmarks'];
    const results = {};
    let completed = 0;
    
    tables.forEach(table => {
      db.all(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
        if (!err) {
          results[table] = { count: row[0].count };
        } else {
          results[table] = { error: err.message };
        }
        
        completed++;
        if (completed === tables.length) {
          res.json(results);
        }
      });
    });
  });

  // 통합 요약 데이터 API (프론트엔드용)
  app.get('/api/summary', (req, res) => {
    const childId = req.query.child_id || null;
    
    const results = {};
    let completed = 0;
    const tables = ['children', 'schedules', 'homeworks', 'events', 'supplies'];
    
    tables.forEach(table => {
      let query = `SELECT * FROM ${table}`;
      const params = [];
      
      // child_id가 있는 테이블이고 childId가 제공된 경우 필터링
      if (childId && ['schedules', 'homeworks', 'events', 'supplies'].includes(table)) {
        query += ' WHERE child_id = ?';
        params.push(childId);
      }
      
      // 정렬 추가
      if (table === 'schedules') query += ' ORDER BY day_of_week, start_time';
      if (table === 'homeworks') query += ' ORDER BY due_date';
      if (table === 'events') query += ' ORDER BY date';
      if (table === 'supplies') query += ' ORDER BY date';
      
      db.all(query, params, (err, rows) => {
        if (err) {
          results[table] = [];
          console.error(`Error fetching ${table}:`, err.message);
        } else {
          results[table] = rows;
        }
        
        completed++;
        if (completed === tables.length) {
          // 프론트엔드가 기대하는 형식으로 응답
          res.json({
            children: results.children || [],
            schedules: results.schedules || [],
            homeworks: results.homeworks || [],
            events: results.events || [],
            supplies: results.supplies || []
          });
        }
      });
    });
  });

  // 특정 아이의 통합 요약 데이터
  app.get('/api/summary/:childId', (req, res) => {
    const childId = req.params.childId;
    
    const results = {};
    let completed = 0;
    const tables = ['children', 'schedules', 'homeworks', 'events', 'supplies'];
    
    tables.forEach(table => {
      let query = `SELECT * FROM ${table}`;
      const params = [];
      
      if (table === 'children') {
        // children 테이블은 모든 아이 조회
        query += ' ORDER BY name';
      } else {
        // 다른 테이블은 child_id로 필터링
        query += ' WHERE child_id = ?';
        params.push(childId);
        
        // 정렬 추가
        if (table === 'schedules') query += ' ORDER BY day_of_week, start_time';
        if (table === 'homeworks') query += ' ORDER BY due_date';
        if (table === 'events') query += ' ORDER BY date';
        if (table === 'supplies') query += ' ORDER BY date';
      }
      
      db.all(query, params, (err, rows) => {
        if (err) {
          results[table] = [];
          console.error(`Error fetching ${table}:`, err.message);
        } else {
          results[table] = rows;
        }
        
        completed++;
        if (completed === tables.length) {
          res.json({
            children: results.children || [],
            schedules: results.schedules || [],
            homeworks: results.homeworks || [],
            events: results.events || [],
            supplies: results.supplies || []
          });
        }
      });
    });
  });

  // 기본 라우트 - 프론트엔드 서빙
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ============ 더미 데이터 생성 API ============
  app.post('/api/seed-dummy-data', (req, res) => {
    console.log('Seeding dummy data...');
    db.serialize(() => {
      // 기존 데이터 삭제
      db.run('DELETE FROM children');
      db.run('DELETE FROM schedules');
      db.run('DELETE FROM homeworks');
      db.run('DELETE FROM events');
      db.run('DELETE FROM supplies');

      // 자녀 데이터
      db.run(`INSERT INTO children (id, name, grade, gender, school) VALUES (1, '김하준', 2, 'boy', '푸른초등학교')`);
      db.run(`INSERT INTO children (id, name, grade, gender, school) VALUES (2, '이서아', 1, 'girl', '새싹유치원')`);

      // 시간표 데이터 (하준)
      db.run(`INSERT INTO schedules (child_id, day_of_week, start_time, end_time, title, category, color) VALUES (1, 1, '09:00', '09:40', '국어', '교과', '#FFDDC1')`);
      db.run(`INSERT INTO schedules (child_id, day_of_week, start_time, end_time, title, category, color) VALUES (1, 1, '15:00', '16:00', '태권도', '학원', '#FF6B6B')`);
      db.run(`INSERT INTO schedules (child_id, day_of_week, start_time, end_time, title, category, color) VALUES (1, 2, '14:00', '15:30', '피아노', '학원', '#C1FFD7')`);

      // 숙제 데이터 (하준)
      db.run(`INSERT INTO homeworks (child_id, subject, title, due_date, status) VALUES (1, '수학', '수학익힘책 p.20-22 풀기', '2026-04-13', '미완료')`);
      db.run(`INSERT INTO homeworks (child_id, subject, title, due_date, status) VALUES (1, '국어', '받아쓰기 연습 5번 하기', '2026-04-12', '완료')`);

      // 이벤트 데이터 (서아)
      db.run(`INSERT INTO events (child_id, title, date, description) VALUES (2, '소풍 가는 날', '2026-04-15', '도시락, 돗자리 챙기기')`);

      // 준비물 데이터 (하준)
      db.run(`INSERT INTO supplies (child_id, date, item_name, category) VALUES (1, '2026-04-14', '색종이, 가위, 풀', '미술')`);

      console.log('Dummy data seeded successfully.');
      res.status(201).json({ message: 'Dummy data seeded successfully.' });
    });
  });

  app.listen(PORT, () => {
    console.log(`KidsBoard server running on http://localhost:${PORT}`);
    setTimeout(() => { if(newsCollector.collectAndClassifyNews) newsCollector.collectAndClassifyNews(db).catch(e => console.error(e)); }, 1000);
  });

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, backing up DB...');
    if (gcsFile) {
        try {
            await gcsFile.save(fs.readFileSync(LOCAL_DB));
            console.log('Final DB backup to Cloud Storage');
        } catch(e) {
            console.error('Final backup failed', e);
        }
    }
    process.exit(0);
  });
})();
