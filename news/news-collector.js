const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'kidsboard.db');
const SEARCH_KEYWORDS = ["초등 교육 정보", "육아 팁", "학습 가이드"];
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function setupDatabase() {
    return new sqlite3.Database(DB_PATH);
}

async function fetchGoogleNews(keywords) {
    const newsList = [];
    for (const kw of keywords) {
        try {
            const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=ko&gl=KR&ceid=KR:ko`;
            const res = await axios.get(url, { timeout: 10000 });
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

async function analyzeWithAI(articles) {
    if (!OPENROUTER_API_KEY) {
        return articles.map(a => ({
            ...a,
            category: classifyNewsLegacy(a.title),
            summary: `${a.source} - ${a.pubDate}`
        }));
    }

    const prompt = `다음 뉴스 기사들의 제목을 보고 각각 '육아꿀팁', '학습법', '입시/정책', '공통' 중 하나로 분류하고, 기사 내용을 예측하여 한 줄 요약을 작성해줘. 
결과는 JSON 배열 형식으로 반환해줘. 예: [{"category": "학습법", "summary": "..."}]

기사 목록:
${articles.map((a, i) => `${i+1}. ${a.title}`).join('\n')}`;

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'google/gemini-2.0-flash-001',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const content = response.data.choices[0].message.content;
        const results = JSON.parse(content).results || JSON.parse(content);
        
        return articles.map((a, i) => ({
            ...a,
            category: results[i]?.category || '공통',
            summary: results[i]?.summary || `${a.source} - ${a.pubDate}`
        }));
    } catch (e) {
        console.error('AI Analysis failed:', e.message);
        return articles.map(a => ({
            ...a,
            category: classifyNewsLegacy(a.title),
            summary: `${a.source} - ${a.pubDate}`
        }));
    }
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

    // AI 분석 (OpenRouter)
    const processed = await analyzeWithAI(articles.slice(0, 15)); // 상위 15개만 분석

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
