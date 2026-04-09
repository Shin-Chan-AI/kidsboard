const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'kidsboard.db');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

function getKSTDate() {
  const now = new Date();
  now.setHours(now.getHours() + 9);
  return now.toISOString().split('T')[0];
}

function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(tomorrow.getHours() + 9);
  return tomorrow.toISOString().split('T')[0];
}

function getTodayDayOfWeek() {
  const now = new Date();
  now.setHours(now.getHours() + 9);
  return now.getDay();
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[알림]', message);
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
    });
    console.log('[전송 완료]', message);
  } catch (err) {
    console.error('[전송 실패]', err.message);
  }
}

// 1. 스케줄 알림 (30분 전)
function checkSchedules() {
  const dayOfWeek = getTodayDayOfWeek();
  db.all(
    `SELECT s.*, c.name AS child_name FROM schedules s
     JOIN children c ON s.child_id = c.id
     WHERE s.day_of_week = ? AND s.recurring = 1`,
    [dayOfWeek], (err, rows) => {
    if (err) return console.error(err.message);
    rows.forEach(s => {
      sendTelegram(`⏰ 30분 후 ${s.child_name} ${s.title} 시작! (${s.start_time}, ${s.location || '장소 미정'})`);
    });
  });
}

// 2. 숙제 알림 (마감 하루 전)
function checkHomeworks() {
  const tomorrow = getTomorrowDate();
  db.all(
    `SELECT h.*, c.name AS child_name FROM homeworks h
     JOIN children c ON h.child_id = c.id
     WHERE h.due_date = ? AND h.status = 'pending'`,
    [tomorrow], (err, rows) => {
    if (err) return console.error(err.message);
    rows.forEach(h => {
      sendTelegram(`📝 내일 ${h.child_name} ${h.subject} 숙제 마감! (${h.title})`);
    });
  });
}

// 3. 준비물 알림 (전날)
function checkSupplies() {
  const tomorrow = getTomorrowDate();
  db.all(
    `SELECT s.*, c.name AS child_name FROM supplies s
     JOIN children c ON s.child_id = c.id
     WHERE s.date = ? AND s.is_checked = 0`,
    [tomorrow], (err, rows) => {
    if (err) return console.error(err.message);
    const grouped = {};
    rows.forEach(s => {
      if (!grouped[s.child_name]) grouped[s.child_name] = [];
      grouped[s.child_name].push(s.item_name);
    });
    Object.entries(grouped).forEach(([name, items]) => {
      sendTelegram(`🎒 내일 ${name} 준비물: ${items.join(', ')}`);
    });
  });
}

// 4. 주간 리포트 (일요일)
function checkWeeklyReport() {
  const now = new Date();
  now.setHours(now.getHours() + 9);
  if (now.getDay() !== 0) return;

  db.all('SELECT id, name FROM children', [], (err, children) => {
    if (err) return console.error(err.message);
    children.forEach(child => {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      db.get(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as done
         FROM homeworks WHERE child_id=? AND due_date BETWEEN ? AND ?`,
        [child.id, weekAgo.toISOString().split('T')[0], now.toISOString().split('T')[0]],
        (err, row) => {
          if (err) return console.error(err.message);
          const rate = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
          sendTelegram(`📊 ${child.name} 이번 주 숙제 완료율: ${rate}% (${row.done}/${row.total})`);
        }
      );
    });
  });
}

// 실행
const hour = new Date().getHours() + 9;
if (hour >= 7 && hour <= 22) checkSchedules();
if (hour >= 20 && hour <= 21) checkHomeworks();
if (hour >= 20 && hour <= 21) checkSupplies();
if (hour >= 20 && hour <= 21) checkWeeklyReport();

console.log('알림 체크 완료');
db.close();
