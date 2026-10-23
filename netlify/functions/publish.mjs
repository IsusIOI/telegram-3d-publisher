import { getStore } from '@netlify/blobs';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const b64 = (data) => Buffer.from(data, 'base64');

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return json(405, { error: 'Разрешён только POST-запрос.' });
    }

    const adminKey = process.env.ADMIN_KEY;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const channel = process.env.TELEGRAM_CHANNEL || '@isusgame';
    const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');

    const missing = [
      ['ADMIN_KEY', adminKey],
      ['TELEGRAM_BOT_TOKEN', botToken],
      ['TELEGRAM_BOT_USERNAME', botUsername]
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (missing.length) {
      return json(500, { error: 'Не заданы переменные: ' + missing.join(', ') });
    }

    let data;

    try {
      data = await req.json();
    } catch {
      return json(400, { error: 'Не удалось прочитать данные формы.' });
    }

    if (data.adminKey !== adminKey) {
      return json(401, { error: 'Неверный ключ администратора.' });
    }

    if (!data.title?.trim() || !data.modelBase64) {
      return json(400, { error: 'Укажи название и выбери файл модели .glb.' });
    }

    if (data.modelBase64.length > 5_000_000) {
      return json(413, {
        error: 'Модель слишком большая. Текущий лимит около 3,5 МБ.'
      });
    }

    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const store = getStore('krutilka-models');
    const modelBytes = b64(data.modelBase64);

    await store.set(`models/${id}.glb`, modelBytes, {
      metadata: { title: data.title.trim() }
    });

    const record = {
      id,
      title: data.title.trim(),
      description: (data.description || '').trim(),
      createdAt: new Date().toISOString(),
      fileName: data.fileName || 'model.glb'
    };

    if (data.previewBase64) {
      if (data.previewBase64.length > 1_500_000) {
        return json(413, {
          error: 'Превью слишком большое. Выбери изображение до 1 МБ.'
        });
      }

      const imageType =
        data.previewType === 'image/png' ? 'image/png' : 'image/jpeg';

      await store.set(`previews/${id}`, b64(data.previewBase64), {
        metadata: { contentType: imageType }
      });

      record.previewType = imageType;
    }

    await store.set(`records/${id}.json`, JSON.stringify(record));

    const base = process.env.URL
      ? new URL(process.env.URL).origin
      : `https://${req.headers.get('host')}`;

    const viewUrl = `${base}/?model=${id}`;
    const keyboard = {
      inline_keyboard: [[
        { text: '🔄 Покрутить в 3D', url: viewUrl }
      ]]
    };

    const caption =
      `🧊 ${record.title}` +
      (record.description ? `\n\n${record.description}` : '');

    let tg;

    if (record.previewType) {
      const photoUrl = `${base}/.netlify/functions/preview?id=${id}`;

      tg = await fetch(
        `https://api.telegram.org/bot${botToken}/sendPhoto`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: channel,
            photo: photoUrl,
            caption: caption.slice(0, 1000),
            reply_markup: keyboard
          })
        }
      );
    } else {
      tg = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: channel,
            text: caption,
            reply_markup: keyboard,
            disable_web_page_preview: false
          })
        }
      );
    }

    const result = await tg.json().catch(() => ({}));

    if (!tg.ok || !result.ok) {
      return json(502, {
        error: `Модель сохранена, но Telegram не опубликовал пост: ${result.description || tg.status}. Проверь токен бота и его права в канале.`,
        modelUrl: viewUrl
      });
    }

    return json(200, {
      ok: true,
      id,
      viewUrl,
      message: 'Опубликовано в канале.'
    });
  } catch (error) {
    console.error('publish error:', error);

    return json(500, {
      error: 'Ошибка сервера при публикации. Проверь журналы функции в Netlify.'
    });
  }
};
