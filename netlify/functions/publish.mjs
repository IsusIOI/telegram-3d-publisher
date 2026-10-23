import { getStore } from '@netlify/blobs';

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
const b64 = (data) => Buffer.from(data, 'base64');

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const adminKey = process.env.ADMIN_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channel = process.env.TELEGRAM_CHANNEL || '@isusgame';
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
  if (!adminKey || !botToken || !botUsername) return json(500, { error: 'На Netlify не заданы ADMIN_KEY, TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME.' });
  let data;
  try { data = JSON.parse(req.body || '{}'); } catch { return json(400, { error: 'Некорректные данные формы.' }); }
  if (data.adminKey !== adminKey) return json(401, { error: 'Неверный ключ администратора.' });
  if (!data.title?.trim() || !data.modelBase64) return json(400, { error: 'Нужны название и файл .glb.' });
  if (data.modelBase64.length > 5_000_000) return json(413, { error: 'Модель слишком большая для текущей версии (лимит около 3.5 МБ). Нужен способ загрузки крупных файлов.' });
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const store = getStore('krutilka-models');
  const modelBytes = b64(data.modelBase64);
  await store.set(`models/${id}.glb`, modelBytes, { metadata: { title: data.title.trim() } });
  const record = { id, title: data.title.trim(), description: (data.description || '').trim(), createdAt: new Date().toISOString(), fileName: data.fileName || 'model.glb' };
  if (data.previewBase64) {
    if (data.previewBase64.length > 1_500_000) return json(413, { error: 'Картинка превью слишком большая. Выбери изображение до 1 МБ.' });
    const imageType = data.previewType === 'image/png' ? 'image/png' : 'image/jpeg';
    await store.set(`previews/${id}`, b64(data.previewBase64), { metadata: { contentType: imageType } });
    record.previewType = imageType;
  }
  await store.set(`records/${id}.json`, JSON.stringify(record));
  const base = `https://${process.env.URL ? new URL(process.env.URL).host : req.headers.host}`;
  const viewUrl = `${base}/?model=${id}`;
  const keyboard = { inline_keyboard: [[{ text: '🔄 Покрутить в 3D', url: viewUrl }]] };
  const caption = `🧊 ${record.title}${record.description ? `\n\n${record.description}` : ''}`;
  let tg;
  if (record.previewType) {
    const photoUrl = `${base}/.netlify/functions/preview?id=${id}`;
    tg = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: channel, photo: photoUrl, caption: caption.slice(0, 1000), reply_markup: keyboard }) });
  } else {
    tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: channel, text: caption, reply_markup: keyboard, disable_web_page_preview: false }) });
  }
  const result = await tg.json().catch(() => ({}));
  if (!tg.ok || !result.ok) return json(502, { error: `Модель сохранена, но Telegram не опубликовал пост: ${result.description || tg.status}. Проверь права бота в канале.` , modelUrl: viewUrl });
  return json(200, { ok: true, id, viewUrl, message: 'Опубликовано в канале.' });
};
