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

// Comprueba si la hora actual (UTC) coincide con la hora configurada en Firebase
// sendTime se guarda como "HH:MM" en hora Canarias
// Canarias: UTC+0 invierno, UTC+1 verano (WEST)
function isTimeToRun(sendTime) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();

  // Detectar si estamos en horario de verano (última domingo de marzo → última domingo de octubre)
  // Aproximación: meses 4-10 (abril-octubre) = WEST = UTC+1
  const month = now.getUTCMonth() + 1; // 1-12
  const isWest = month >= 4 && month <= 10;
  const offsetHours = isWest ? 1 : 0;

  // Hora local Canarias
  const localHour = (utcHour + offsetHours) % 24;
  const localMin  = utcMin;

  const [cfgHour, cfgMin] = sendTime.split(':').map(Number);

  const match = localHour === cfgHour && localMin < 60; // ejecuta en cualquier minuto de esa hora
  console.log(`Hora actual Canarias: ${String(localHour).padStart(2,'0')}:${String(localMin).padStart(2,'0')} | Hora configurada: ${sendTime} | ¿Ejecutar? ${match}`);
  return match;
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

  // 2. Comprobar si es la hora de enviar
  if (!isTimeToRun(SEND_TIME)) {
    console.log('No es la hora configurada. Saliendo sin enviar.');
    process.exit(0);
  }

  console.log(`✓ Es la hora de envío. Umbral: ${THRESHOLD}% | Municipios: ${MUNICIPALITIES.map(m => m.name).join(', ')}`);

  // 3. Consultar tiempo y construir mensaje
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

  // 4. Enviar si hay alertas
  if (alerts) {
    await sendTelegram(header + body + `_Umbral: ${THRESHOLD}%_`);
    console.log('✅ Alerta enviada por Telegram.');
  } else {
    console.log(`✅ Sin alertas. Ningún municipio supera el ${THRESHOLD}%.`);
  }
})();
