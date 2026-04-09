const axios = require('axios');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function getParentingAdvice(childData) {
    if (!OPENROUTER_API_KEY) {
        return "OpenRouter API 키가 설정되지 않았습니다. AI 조언을 받으려면 API 키를 설정해주세요.";
    }

    const { name, grade, gender, schedules, homeworks, events, supplies } = childData;
    
    const context = `아이 이름: ${name}, 학년: ${grade}, 성별: ${gender}
오늘의 준비물: ${supplies?.map(s => s.item_name).join(', ') || '없음'}
진행 중인 숙제: ${homeworks?.map(h => `${h.subject}: ${h.title}`).join(', ') || '없음'}
주요 일정: ${events?.map(e => e.title).join(', ') || '없음'}
스케줄: ${schedules?.map(s => s.title).join(', ') || '없음'}`;

    const prompt = `당신은 초등학생 자녀를 둔 부모님을 돕는 'AI 육아 전문가'입니다. 
다음은 오늘 아이의 현황입니다. 이 정보를 바탕으로 부모님이 오늘 아이에게 어떤 도움을 주면 좋을지, 
따뜻하고 구체적인 조언을 3~4문장으로 작성해주세요. 

현황:
${context}`;

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'google/gemini-2.0-flash-001',
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (e) {
        console.error('OpenRouter Advice Error:', e.message);
        return "AI 조언을 가져오는 중에 오류가 발생했습니다.";
    }
}

module.exports = { getParentingAdvice };
