// RainWatch — check-rain.js
// Ubicación en el repo: .github/scripts/check-rain.js

// Validar secrets antes de nada
if (!process.env.TG_TOKEN)       { console.error('❌ Falta el secret TG_TOKEN');       process.exit(1); }
if (!process.env.TG_CHAT_ID)     { console.error('❌ Falta el secret TG_CHAT_ID');     process.exit(1); }
if (!process.env.MUNICIPALITIES) { console.error('❌ Falta el secret MUNICIPALITIES'); process.exit(1); }
if (!process.env.THRESHOLD)      { console.error('❌ Falta el secret THRESHOLD');      process.exit(1); }

const THRESHOLD = parseInt(process.env.THRESHOLD) || 20;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

let MUNICIPALITIES;
try {
  MUNICIPALITIES = JSON.parse(process.env.MUNICIPALITIES);
} catch(e) {
  console.error('❌ El secret MUNICIPALITIES no es JSON válido:', process.env.MUNICIPALITIES);
  process.exit(1);
}

const WMO = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla helada', 51: 'Llovizna ligera', 53: 'Llovizna', 55: 'Llovizna densa',
  61: 'Lluvia ligera', 63: 'Lluvia', 65: 'Lluvia intensa',
  71: 'Nevada ligera', 73: 'Nevada', 75: 'Nevada intensa',
  80: 'Chubascos ligeros', 81: 'Chubascos', 82: 'Chubascos fuertes',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta intensa'
};

const WMO_EMOJI = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
  71: '❄️', 73: '❄️', 75: '❄️', 80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈'
};

async function fetchWeather(m) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${m.lat}&longitude=${m.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&timezone=Atlantic/Canary&forecast_days=2`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${m.name}`);
  const data = await res.json();
  const d = data.daily;

  return {
    tmax: Math.round(d.temperature_2m_max[1]),
    tmin: Math.round(d.temperature_2m_min[1]),
    rain: d.precipitation_probability_max[1],
    code: d.weathercode[1]
  };
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'Markdown' })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
}

(async () => {
  console.log(`Umbral: ${THRESHOLD}% | Municipios: ${MUNICIPALITIES.map(m => m.name).join(', ')}`);

  let header = '🛰 *RainWatch: Previsión de mañana*\n\n';
  let body = '';
  let alerts = false;

  for (const m of MUNICIPALITIES) {
    try {
      const w = await fetchWeather(m);
      console.log(`${m.name}: ${w.rain}% lluvia (umbral: ${THRESHOLD}%)`);

      if (w.rain >= THRESHOLD) {
        alerts = true;
        const emoji = WMO_EMOJI[w.code] || '🌡';
        const desc = WMO[w.code] || 'Variable';
        body += `📍 *${m.name}*\n`;
        body += `${emoji} ${desc}\n`;
        body += `💧 Probabilidad lluvia: *${w.rain}%*\n`;
        body += `🌡️ ${w.tmin}° / ${w.tmax}°\n\n`;
      }
    } catch (e) {
      console.error(`Error en ${m.name}:`, e.message);
    }
  }

  if (alerts) {
    await sendTelegram(header + body + `_Umbral configurado: ${THRESHOLD}%_`);
    console.log('✅ Alerta enviada por Telegram.');
  } else {
    console.log('✅ Sin alertas. Ningún municipio supera el umbral.');
  }
})();
