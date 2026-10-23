const OK = () => new Response('ok');

const HELP =
  'Команда для публикации:\n\n' +
  '/post имя Название | Описание\n\n' +
  'Пример: /post jiga Jiga | Моя первая модель\n' +
  'Имя — это имя файла из папки models без .glb (латиница, цифры, _ и -).\n' +
  'Чтобы добавить картинку, отправь её с этой командой в подписи.';

export default async (req) => {
  if (req.method !== 'POST') return OK();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
  const channel = process.env.TELEGRAM_CHANNEL || '@isusgame';
  const adminId = String(process.env.ADMIN_TG_ID || '');
  const secret = process.env.WEBHOOK_SECRET || '';

  if (!botToken || !botUsername || !adminId || !secret) {
    return new Response('Не заданы переменные окружения', { status: 500 });
  }
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return OK();
  }

  const msg = update.message;
  if (!msg || !msg.chat) return OK();
  if (String(msg.from && msg.from.id) !== adminId) return OK();

  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false, description: 'нет связи с Telegram' }));

  const reply = (text) => api('sendMessage', { chat_id: msg.chat.id, text });

  const text = (msg.text || msg.caption || '').trim();

  if (!/^\/post(@\w+)?(\s|$)/i.test(text)) {
    await reply(HELP);
    return OK();
  }

  const rest = text.replace(/^\/post(@\w+)?\s*/i, '');
  const m = rest.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) {
    await reply(HELP);
    return OK();
  }

  const name = m[1].replace(/\.glb$/i, '');
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    await reply('Имя модели может содержать только латиницу, цифры, _ и -.\n\n' + HELP);
    return OK();
  }

  const parts = m[2].split('|');
  const title = (parts[0] || '').trim() || name;
  const description = parts.slice(1).join('|').trim();

  // Проверка, что файл модели лежит в репозитории
  try {
    const check = await fetch(
      `https://raw.githubusercontent.com/IsusIOI/telegram-3d-publisher/main/models/${name}.glb`,
      { method: 'HEAD' }
    );
    if (check.status === 404) {
      await reply(`Файл models/${name}.glb не найден в репозитории. Загрузи его на GitHub и повтори.`);
      return OK();
    }
  } catch {
    // сеть до GitHub не ответила — публикуем без проверки
  }

  const link = `https://t.me/${botUsername}?startapp=${name}`;
  const keyboard = { inline_keyboard: [[{ text: '🔄 Покрутить в 3D', url: link }]] };
  const caption = `🧊 ${title}` + (description ? `\n\n${description}` : '');

  const photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : null;

  const result = photo
    ? await api('sendPhoto', {
        chat_id: channel,
        photo,
        caption: caption.slice(0, 1000),
        reply_markup: keyboard
      })
    : await api('sendMessage', {
        chat_id: channel,
        text: caption,
        reply_markup: keyboard
      });

  if (result.ok) {
    await reply(`✅ Опубликовано в ${channel}\n${link}`);
  } else {
    await reply(
      `❌ Telegram не принял пост: ${result.description || 'неизвестная ошибка'}.\n` +
        'Проверь, что бот добавлен в канал администратором с правом публиковать сообщения.'
    );
  }

  return OK();
};
