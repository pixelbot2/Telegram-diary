// Load environment variables from .env file
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

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

console.log('📗 Bot started successfully...');

// --- Helper ---
function buildInlineKeyboard(items, type) {
  const buttons = items.map(item =>
    [{ text: typeof item === 'object' ? item.text : item, callback_data: `${type}:${typeof item === 'object' ? item.value : item}` }]
  );
  return { inline_keyboard: buttons };
}

function startBot(chatId) {
  const message = '📝 *Welcome to the Diary Maker!*\n\nStep 1 — Please select your *Class*:';
  const keyboard = buildInlineKeyboard(classes, 'class');
  bot.sendMessage(chatId, message, { reply_markup: keyboard, parse_mode: 'Markdown' })
    .then(sent => {
      userStates.set(chatId, { step: 'AWAITING_CLASS', messageId: sent.message_id });
    });
}

// --- Commands ---
bot.onText(/\/start/, (msg) => startBot(msg.chat.id));

// --- Callback Handler ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [type, value] = query.data.split(':');
  const state = userStates.get(chatId) || {};
  await bot.answerCallbackQuery(query.id).catch(() => {});

  // CLASS chosen
  if (type === 'class' && state.step === 'AWAITING_CLASS') {
    state.class = value;
    state.step = 'AWAITING_SUBJECT';
    userStates.set(chatId, state);

    const text = `🎓 *Class:* ${value}\n\nStep 2 — Please select the *Subject*:`;
    const keyboard = buildInlineKeyboard(subjects, 'subject');
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: state.messageId || query.message.message_id,
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    });
    return;
  }

  // SUBJECT chosen
  if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
    state.subject = value;
    state.step = 'AWAITING_TEACHER';
    userStates.set(chatId, state);

    const text = `🎓 *Class:* ${state.class}\n📚 *Subject:* ${value}\n\nStep 3 — Please enter the *Teacher's Name* (text):`;
    // edit previous message (if present) or send new
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: state.messageId || query.message.message_id,
      parse_mode: 'Markdown'
    });
    return;
  }

  // HW yes/no choice
  if (type === 'hasHW' && (state.step === 'AWAITING_HW_CONFIRM' || state.step === 'AWAITING_CW_AFTER')) {
    if (value === 'yes') {
      state.step = 'AWAITING_HW';
      userStates.set(chatId, state);
      await bot.sendMessage(chatId, '📘 OK — Please send the *Homework (HW)* text:');
    } else {
      // no HW: proceed to remarks step (but as per your requirement, if HW is NO -> close the process and give file)
      // So we will skip remarks and directly call the /generate endpoint using class, subject, cw, teacher.
      state.hw = '';
      state.remarks = '';
      state.step = 'GENERATE_NO_HW';
      userStates.set(chatId, state);
      await generateImageAndSend(chatId, state, false);
      userStates.delete(chatId);
    }
    return;
  }

  // Restart button
  if (type === 'restart') {
    startBot(chatId);
    return;
  }
});

// --- Message Handler ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state || !state.step) {
    // If no flow started, start it
    startBot(chatId);
    return;
  }

  switch (state.step) {
    case 'AWAITING_TEACHER':
      state.teacher = text;
      state.step = 'AWAITING_CW';
      userStates.set(chatId, state);
      await bot.sendMessage(chatId, '✍️ Step 4 — Please send the *Classwork (CW)* text:');
      // optionally delete the user's message to keep chat clean:
      // bot.deleteMessage(chatId, msg.message_id).catch(()=>{});
      break;

    case 'AWAITING_CW':
      state.cw = text;
      state.step = 'AWAITING_HW_CONFIRM';
      userStates.set(chatId, state);

      // Ask HW yes/no
      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Yes', callback_data: 'hasHW:yes' }, { text: '❌ No', callback_data: 'hasHW:no' }]
        ]
      };
      await bot.sendMessage(chatId, 'Step 5 — Do you have *Homework (HW)*?', { reply_markup: keyboard, parse_mode: 'Markdown' });
      break;

    case 'AWAITING_HW':
      state.hw = text;
      state.step = 'AWAITING_REMARKS';
      userStates.set(chatId, state);
      await bot.sendMessage(chatId, 'Please enter *Remarks* (type "none" if no remarks):');
      break;

    case 'AWAITING_REMARKS':
      state.remarks = (text && text.toLowerCase() === 'none') ? '' : text;
      userStates.set(chatId, state);

      // All inputs collected: call generate-hw
      await generateImageAndSend(chatId, state, true);
      userStates.delete(chatId);
      break;

    default:
      // unknown step -> restart
      startBot(chatId);
      break;
  }
});

// --- Image generation helper ---
async function generateImageAndSend(chatId, state, hasHW) {
  try {
    await bot.sendMessage(chatId, '🎨 Generating your diary image... Please wait.');

    let url = '';
    if (hasHW) {
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw,
        hw: state.hw,
        remarks: state.remarks,
        teacher: state.teacher
      });
      url = `https://diaryapifinal.onrender.com/generate-hw?${params.toString()}`;
    } else {
      // No HW: call generate (teacher included)
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw,
        teacher: state.teacher
      });
      url = `https://diaryapifinal.onrender.com/generate?${params.toString()}`;
    }

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    const captionParts = [
      `✅ Diary generated successfully!`,
      `📚 Subject: ${state.subject}`,
      `✏️ CW: ${state.cw}`
    ];
    if (hasHW) captionParts.push(`📘 HW: ${state.hw}`, `🗒️ Remarks: ${state.remarks || '—'}`);
    captionParts.push(`👩‍🏫 Teacher: ${state.teacher}`);

    await bot.sendPhoto(chatId, imageBuffer, {
      caption: captionParts.join('\n'),
      parse_mode: 'Markdown'
    });

    // Offer restart
    const keyboard = { inline_keyboard: [[{ text: '🔁 Create another diary', callback_data: 'restart' }]] };
    await bot.sendMessage(chatId, 'Would you like to create another?', { reply_markup: keyboard });
  } catch (err) {
    console.error('Error generating diary image:', err && err.message ? err.message : err);
    await bot.sendMessage(chatId, '⚠️ Failed to generate diary. Please try again.');
  }
}
