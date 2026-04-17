// RainWatch — check-rain.js
// Ubicación: .github/scripts/check-rain.js

const TG_TOKEN     = process.env.TG_TOKEN;
const TG_CHAT_ID   = process.env.TG_CHAT_ID;
const FIREBASE_KEY = process.env.FIREBASE_API_KEY;
const RTDB_URL     = 'https://lista-compra-9d6f5-default-rtdb.europe-west1.firebasedatabase.app';

if (!TG_TOKEN)     { console.error('Falta TG_TOKEN');         process.exit(1); }
if (!TG_CHAT_ID)   { console.error('Falta TG_CHAT_ID');       process.exit(1); }
if (!FIREBASE_KEY) { console.error('Falta FIREBASE_API_KEY'); process.exit(1); }

const WMO = {
  0:'Despejado',1:'Mayormente despejado',2:'Parcialmente nublado',3:'Nublado',
  45:'Niebla',48:'Niebla helada',51:'Llovizna ligera',53:'Llovizna',55:'Llovizna densa',
  61:'Lluvia ligera',63:'Lluvia',65:'Lluvia intensa',
  71:'Nevada ligera',73:'Nevada',75:'Nevada intensa',
  80:'Chubascos ligeros',81:'Chubascos',82:'Chubascos fuertes',
  95:'Tormenta',96:'Tormenta con granizo',99:'Tormenta intensa'
};
const WMO_EMOJI = {
  0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',
  51:'🌦',53:'🌦',55:'🌧',61:'🌧',63:'🌧',65:'🌧',
  71:'❄️',73:'❄️',75:'❄️',80:'🌦',81:'🌧',82:'⛈',
  95:'⛈',96:'⛈',99:'⛈'
};

async function loadConfig() {
  const res = await fetch(`${RTDB_URL}/rainwatch/config.json?auth=${FIREBASE_KEY}`);
  if (!res.ok) throw new Error(`Firebase error ${res.status}`);
  const data = await res.json();
  if (!data) throw new Error('No hay configuración en Firebase. Guarda la config desde la app primero.');
  return data;
}

async function getLastSentDate() {
  const res = await fetch(`${RTDB_URL}/rainwatch/lastSent.json?auth=${FIREBASE_KEY}`);
  if (!res.ok) return null;
  return await res.json(); // "YYYY-MM-DD" o null
}

async function setLastSentDate(dateStr) {
  await fetch(`${RTDB_URL}/rainwatch/lastSent.json?auth=${FIREBASE_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dateStr)
  });
}

function getCanariasTime() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const isWest = month >= 4 && month <= 10; // horario de verano aproximado
  const offsetMs = isWest ? 3600000 : 0;
  const local = new Date(now.getTime() + offsetMs);
  return {
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    dateStr: local.toISOString().slice(0, 10) // "YYYY-MM-DD"
  };
}

async function fetchWeather(m) {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${m.lat}&longitude=${m.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&timezone=Atlantic/Canary&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
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
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'Markdown' })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram: ${data.description}`);
}

(async () => {
  // 1. Leer config desde Firebase
  const cfg = await loadConfig();
  const THRESHOLD      = cfg.threshold || 20;
  const MUNICIPALITIES = cfg.municipalities || [];
  const SEND_TIME      = cfg.sendTime || '08:00';

  const [cfgHour, cfgMin] = SEND_TIME.split(':').map(Number);
  const { hour, minute, dateStr } = getCanariasTime();
  const nowMinutes = hour * 60 + minute;
  const cfgMinutes = cfgHour * 60 + cfgMin;

  console.log(`Hora Canarias: ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} | Hora configurada: ${SEND_TIME}`);

  // 2. ¿Ha llegado la hora?
  if (nowMinutes < cfgMinutes) {
    console.log(`Aún no ha llegado la hora de envío. Faltan ${cfgMinutes - nowMinutes} minutos.`);
    process.exit(0);
  }

  // 3. ¿Ya se envió hoy?
  const lastSent = await getLastSentDate();
  if (lastSent === dateStr) {
    console.log(`Ya se procesó hoy (${dateStr}). No se vuelve a enviar.`);
    process.exit(0);
  }

  console.log(`✓ Hora alcanzada. Umbral: ${THRESHOLD}% | Municipios: ${MUNICIPALITIES.map(m => m.name).join(', ')}`);

  // 4. Consultar tiempo y construir mensaje
  let header = '🛰 *RainWatch: Previsión de mañana*\n\n';
  let body = '';
  let alerts = false;

  for (const m of MUNICIPALITIES) {
    try {
      const w = await fetchWeather(m);
      console.log(`${m.name}: ${w.rain}% lluvia`);
      if (w.rain >= THRESHOLD) {
        alerts = true;
        body += `📍 *${m.name}*\n`;
        body += `${WMO_EMOJI[w.code] || '🌡'} ${WMO[w.code] || 'Variable'}\n`;
        body += `💧 Probabilidad lluvia: *${w.rain}%*\n`;
        body += `🌡️ ${w.tmin}° / ${w.tmax}°\n\n`;
      }
    } catch(e) { console.error(`Error en ${m.name}:`, e.message); }
  }

  // 5. Enviar si hay alertas y marcar como enviado
  if (alerts) {
    await sendTelegram(header + body + `_Umbral: ${THRESHOLD}%_`);
    console.log('✅ Alerta enviada por Telegram.');
  } else {
    console.log(`✅ Sin alertas. Ningún municipio supera el ${THRESHOLD}%.`);
  }

  // Marcar como procesado hoy independientemente de si hubo alertas
  await setLastSentDate(dateStr);
  console.log(`Marcado como procesado para ${dateStr}.`);
})();
