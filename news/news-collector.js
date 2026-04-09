'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

async function fetchGoogleNews(keywords) {
    const newsList = [];
    const seenUrls = new Set();
    
    for (const kw of keywords) {
        try {
            const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(kw + ' 뉴스')}&hl=ko-KR&gl=KR&ceid=KR:ko`;
            const res = await axios.get(searchUrl, { 
              timeout: 10000,
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $ = cheerio.load(res.data, { xmlMode: true });

            $('item').slice(0, 8).each((i, el) => {
                let titleText = $(el).find('title').text().replace(/<[^>]*>/g, '').trim();
                const linkText = $(el).find('link').text().replace(/<[^>]*>/g, '').trim();
                const sourceEl = $(el).find('source');
                const sourceText = sourceEl.text().replace(/<[^>]*>/g, '').trim();
                const sourceUrl = sourceEl.attr('url') || '';

                const descEl = $(el).find('description').text();
                let summary = '';
                if (descEl) {
                    summary = descEl.replace(/<[^>]*>/g, '').trim();
                }

                if (!titleText || !linkText || seenUrls.has(linkText)) return;
                seenUrls.add(linkText);

                newsList.push({
                    title: titleText,
                    url: linkText,
                    source: sourceText || sourceUrl,
                    summary: summary.substring(0, 200),
                    category: '공통'
                });
            });

            if (newsList.length >= 15) break;
        } catch (e) {
            console.error(`Failed to fetch for ${kw}:`, e.message);
        }
    }
    return newsList;
}

module.exports = { fetchGoogleNews };
