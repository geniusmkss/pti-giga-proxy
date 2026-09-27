const express = require('express');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// === GIGACHAT ===
let token = null;
let tokenExpires = 0;

async function getToken() {
  if (token && Date.now() < tokenExpires) return token;
  const r = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': crypto.randomUUID(),
      'Authorization': 'Basic ' + process.env.GIGACHAT_AUTH_KEY
    },
    body: 'scope=GIGACHAT_API_PERS'
  });
  const data = await r.json();
  token = data.access_token;
  tokenExpires = Date.now() + (data.expires_at * 1000) - 60000;
  return token;
}

app.post('/ask', async (req, res) => {
  try {
    const { message, context } = req.body;
    const t = await getToken();
    const r = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
      body: JSON.stringify({
        model: 'GigaChat',
        messages: [
          { role: 'system', content: 'Ты помощник портала ПТИ НовГУ. Отвечай кратко на русском. Расписание: ' + (context || '') },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 400
      })
    });
    const data = await r.json();
    res.json({ answer: data.choices?.[0]?.message?.content || 'Не удалось ответить' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// === ПОГОДА (Яндекс) ===
app.get('/weather', async (req, res) => {
  try {
    const query = `{
      weatherByPoint(request: { lat: 58.521, lon: 31.271 }) {
        now {
          temperature
          feelsLike
          condition
          windSpeed
          humidity
        }
      }
    }`;
    const r = await fetch('https://api.weather.yandex.ru/graphql/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Yandex-Weather-Key': 'aa845272-7770-42c4-81f3-02d124456eab'
      },
      body: JSON.stringify({ query: query })
    });
    const data = await r.json();
    const now = data.data.weatherByPoint.now;
    res.json({
      temp: now.temperature,
      feels: now.feelsLike,
      code: now.condition,
      wind: now.windSpeed,
      humidity: now.humidity
    });
  } catch (e) {
    console.error('Weather error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('OK'));

app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Started'));
