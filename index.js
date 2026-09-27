const express = require('express');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============================================================
//  GIGACHAT
// ============================================================
let gigaToken = null;
let gigaTokenExpires = 0;

async function getGigaToken() {
  if (gigaToken && Date.now() < gigaTokenExpires) return gigaToken;
  const authKey = process.env.GIGACHAT_AUTH_KEY;
  if (!authKey) throw new Error('GIGACHAT_AUTH_KEY не задан');

  const r = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': crypto.randomUUID(),
      'Authorization': 'Basic ' + authKey
    },
    body: 'scope=GIGACHAT_API_PERS'
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error('GigaChat OAuth ' + r.status + ': ' + errText.slice(0, 200));
  }

  const data = await r.json();
  if (!data.access_token) throw new Error('Нет access_token');
  gigaToken = data.access_token;
  gigaTokenExpires = Date.now() + (data.expires_at * 1000) - 60000;
  return gigaToken;
}

app.post('/ask', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Пустое сообщение' });
    if (message.length > 500) return res.status(400).json({ error: 'Слишком длинное' });

    const token = await getGigaToken();
    const systemPrompt = `Ты ИИ-помощник студенческого портала ПТИ НовГУ (Политехнический институт, Великий Новгород). Отвечай кратко, дружелюбно, на русском. Помогай с расписанием, аудиториями, преподавателями. Если вопрос не про учёбу — вежливо верни к расписанию. Данные: ${context || 'не передано'}`;

    const r = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        model: 'GigaChat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 400
      })
    });

    if (!r.ok) { const errText = await r.text(); throw new Error('GigaChat ' + r.status + ': ' + errText.slice(0, 200)); }
    const data = await r.json();
    res.json({ answer: data.choices?.[0]?.message?.content || 'Не удалось ответить' });
  } catch (e) {
    console.error('[ask]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  ПОГОДА — Яндекс GraphQL (только доступные поля)
// ============================================================
app.get('/weather', async (req, res) => {
  try {
    const gqlQuery = `
      {
        weatherByPoint(request: { lat: 58.521, lon: 31.271 }) {
          now {
            temperature
            condition
            windSpeed
            humidity
          }
        }
      }
    `;

    const r = await fetch('https://api.weather.yandex.ru/graphql/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Yandex-Weather-Key': 'aa845272-7770-42c4-81f3-02d124456eab'
      },
      body: JSON.stringify({ query: gqlQuery })
    });

    const text = await r.text();
    console.log('[Yandex] Status:', r.status);
    console.log('[Yandex] Body:', text.slice(0, 300));

    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error('Yandex вернул не-JSON (status ' + r.status + ')'); }

    if (data.errors) throw new Error('GraphQL: ' + JSON.stringify(data.errors).slice(0, 200));
    if (!data.data || !data.data.weatherByPoint || !data.data.weatherByPoint.now) throw new Error('Нет weatherByPoint.now');

    const now = data.data.weatherByPoint.now;
    res.json({
      temp: now.temperature,
      code: now.condition,
      wind: now.windSpeed,
      humidity: now.humidity
    });
  } catch (e) {
    console.error('Weather error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Started on port ' + PORT));
