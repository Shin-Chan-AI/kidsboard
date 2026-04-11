const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'kidsboard.db');
const SEARCH_KEYWORDS = ["초등 교육 정보", "육아 팁", "학습 가이드"];

function setupDatabase() {
    return new sqlite3.Database(DB_PATH);
}

async function fetchGoogleNews(keywords) {
    console.log('Starting fetchGoogleNews...');
    const newsList = [];
    for (const kw of keywords) {
        try {
            console.log(`Fetching for: ${kw}`);
            const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=ko&gl=KR&ceid=KR:ko`;
            const res = await axios.get(url, { timeout: 15000 }); // Timeout increased
            console.log(`Fetched for: ${kw}, status: ${res.status}`);
            const $ = cheerio.load(res.data, { xmlMode: true });

            $('item').each((i, el) => {
                const title = $(el).find('title').text();
                const url = $(el).find('link').text();
                const source = $(el).find('source').text();
                const pubDate = $(el).find('pubDate').text();
                
                if (title && url) {
                    if (!newsList.some(item => item.url === url)) {
                        newsList.push({ title, url, source, pubDate });
                    }
                }
            });
            if (newsList.length > 30) break;
        } catch (e) {
            console.error(`Failed to fetch for ${kw}:`, e.message);
        }
    }
    return newsList;
}

function classifyNewsLegacy(title) {
    if (title.includes('육아') || title.includes('꿀팁') || title.includes('방법')) return '육아꿀팁';
    if (title.includes('공부') || title.includes('학습') || title.includes('가이드')) return '학습법';
    if (title.includes('정책') || title.includes('입시') || title.includes('학교')) return '입시/정책';
    return '공통';
}

async function collectAndClassifyNews(existingDb) {
    const db = existingDb || setupDatabase();
    
    // Clear old news
    await new Promise((res) => db.run('DELETE FROM news_bookmarks', res));
    console.log('Old news cleared.');

    let articles = await fetchGoogleNews(SEARCH_KEYWORDS);
    
    if (articles.length === 0) {
        articles.push({ title: "초등학생 올바른 학습 습관 기르는 법", url: "#", source: "교육전문", pubDate: new Date().toISOString() });
        articles.push({ title: "2024년 변경된 교육 정책 가이드", url: "#", source: "정책뉴스", pubDate: new Date().toISOString() });
    }

    const processed = articles.slice(0, 15).map(a => ({...a, category: classifyNewsLegacy(a.title), summary: `${a.source} - ${a.pubDate}`}));

    for (const article of processed) {
        const sql = `INSERT OR IGNORE INTO news_bookmarks (title, url, source, summary, tags, age_group) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(sql, [article.title, article.url, article.source, article.summary, article.category, '공통']);
    }

    if (!existingDb) {
        setTimeout(() => db.close(), 2000);
    }
    return processed;
}

module.exports = { collectAndClassifyNews };
