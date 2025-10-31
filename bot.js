// Load environment variables from .env file
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Bot Token
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const userStates = new Map();

const classes = [
  { text: 'STD.I (Orchid & Camellia)', value: 'STD.I (Orchid & Camellia)' },
  { text: 'STD.II (Daffodil & Daisy)', value: 'STD.II (Daffodil & Daisy)' },
  { text: 'STD.III (Magnolia & Gardenia)', value: 'STD.III (Magnolia & Gardenia)' },
  { text: 'STD.IV (Lavender)', value: 'STD.IV (Lavender)' },
  { text: 'STD.V (Azalea)', value: 'STD.V (Azalea)' },
  { text: 'STD.VI (Iris)', value: 'STD.VI (Iris)' },
  { text: 'STD.VII (Aster)', value: 'STD.VII (Aster)' },
];

const subjects = [
  'Music', 'Bangla', 'Art & Craft', 'Value Education', 'English', 'Mathematics', 'Science',
  'Global English', 'Physics', 'BGST', 'ICT', 'Chemistry', 'Biology',
  'Primary English', 'Mathematics D', 'Mathematics Additional',
  'Global Citizenship', 'Global Perspective', 'Global Perspective & Global Citizenship',
];

console.log('Bot started successfully...');

// --- Helper ---
function buildInlineKeyboard(items, type) {
  const buttons = items.map(item =>
    [{ text: typeof item === 'object' ? item.text : item, callback_data: `${type}:${typeof item === 'object' ? item.value : item}` }]
  );
  return { inline_keyboard: buttons };
}

function startBot(chatId) {
  const message = '📝 **Welcome to the Diary Maker!**\n\nSelect your class:';
  const keyboard = buildInlineKeyboard(classes, 'class');
  bot.sendMessage(chatId, message, { reply_markup: keyboard, parse_mode: 'Markdown' });
}

// --- Commands ---
bot.onText(/\/start/, (msg) => startBot(msg.chat.id));

// --- Callback Handler ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [type, value] = query.data.split(':');
  const state = userStates.get(chatId) || {};
  bot.answerCallbackQuery(query.id);

  if (type === 'class') {
    state.class = value;
    state.step = 'AWAITING_SUBJECT';
    userStates.set(chatId, state);
    const msg = `🎓 **Class:** ${value}\n\nNow select the subject:`;
    const keyboard = buildInlineKeyboard(subjects, 'subject');
    bot.editMessageText(msg, {
      chat_id: chatId, message_id: query.message.message_id,
      reply_markup: keyboard, parse_mode: 'Markdown'
    });
  } else if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
    state.subject = value;
    state.step = 'AWAITING_CW';
    userStates.set(chatId, state);
    bot.editMessageText(`🎓 **Class:** ${state.class}\n📚 **Subject:** ${value}\n\nSend the *Classwork (CW)*:`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });
  } else if (type === 'hasHW') {
    if (value === 'yes') {
      state.step = 'AWAITING_HW';
      userStates.set(chatId, state);
      bot.sendMessage(chatId, '📘 Great! Please send the **Homework (HW)** text:', { parse_mode: 'Markdown' });
    } else if (value === 'no') {
      await generateImage(chatId, state, false);
      userStates.delete(chatId);
    }
  }
});

// --- Message Handler ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state) return;

  switch (state.step) {
    case 'AWAITING_CW':
      state.cw = text;
      state.step = 'ASK_HW';
      userStates.set(chatId, state);

      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Yes', callback_data: 'hasHW:yes' }, { text: '❌ No', callback_data: 'hasHW:no' }]
        ]
      };
      bot.sendMessage(chatId, 'Do you have Homework (HW)?', { reply_markup: keyboard });
      break;

    case 'AWAITING_HW':
      state.hw = text;
      state.step = 'AWAITING_REMARKS';
      userStates.set(chatId, state);
      bot.sendMessage(chatId, 'Any remarks? (You can type "none" if not)', { parse_mode: 'Markdown' });
      break;

    case 'AWAITING_REMARKS':
      state.remarks = text === 'none' ? '' : text;
      await generateImage(chatId, state, true);
      userStates.delete(chatId);
      break;
  }
});

// --- Image Generator Function ---
async function generateImage(chatId, state, hasHW) {
  try {
    await bot.sendMessage(chatId, '🎨 Generating your diary image... Please wait.');

    let url = '';
    if (hasHW) {
      // API with HW
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw,
        hw: state.hw,
        remarks: state.remarks
      });
      url = `https://diaryapifinal.onrender.com/generate-hw?${params.toString()}`;
    } else {
      // API without HW
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw
      });
      url = `https://diaryapifinal.onrender.com/generate?${params.toString()}`;
    }

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    await bot.sendPhoto(chatId, imageBuffer, {
      caption: `✅ Diary generated successfully!\n\n📚 *Subject:* ${state.subject}\n✏️ *CW:* ${state.cw}${hasHW ? `\n📘 *HW:* ${state.hw}` : ''}`,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Error generating image:', err.message);
    bot.sendMessage(chatId, '⚠️ Failed to generate diary. Please try again.');
  }
}
