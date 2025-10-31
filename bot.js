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

// --- Data ---
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

console.log('📗 Bot started successfully... (Smooth Version)');

// --- Helper Functions ---

/** Builds the inline keyboard */
function buildInlineKeyboard(items, type) {
  const buttons = items.map(item =>
    [{ text: typeof item === 'object' ? item.text : item, callback_data: `${type}:${typeof item === 'object' ? item.value : item}` }]
  );
  return { inline_keyboard: buttons };
}

/** * Builds the text for the "Single Message" UI.
 * This function creates the summary of what the user has selected so far.
 */
function buildProgressText(state, nextPrompt) {
  const parts = ['📝 *Welcome to the Diary Maker!*'];
  
  if (state.class) parts.push(`🎓 *Class:* \`${state.class}\``);
  if (state.subject) parts.push(`📚 *Subject:* \`${state.subject}\``);
  if (state.teacher) parts.push(`👩‍🏫 *Teacher:* \`${state.teacher}\``);
  if (state.cw) parts.push(`✍️ *CW:* \`${state.cw}\``);
  if (state.hw) parts.push(`📘 *HW:* \`${state.hw}\``);
  
  parts.push(`\n${nextPrompt}`);
  return parts.join('\n');
}

/** * Central function to edit the bot's "Single Message".
 * This is the core of Suggestion #1.
 */
async function updateBotMessage(chatId, state, text, keyboard = null) {
  try {
    const options = {
      chat_id: chatId,
      message_id: state.messageId,
      parse_mode: 'Markdown',
    };
    if (keyboard) {
      options.reply_markup = keyboard;
    }
    await bot.editMessageText(text, options);
  } catch (e) {
    console.warn(`Edit message failed (maybe no change): ${e.message}`);
  }
}

/** Starts the entire flow */
function startBot(chatId) {
  const message = 'Step 1 — Please select your *Class*:';
  const keyboard = buildInlineKeyboard(classes, 'class');
  
  bot.sendMessage(chatId, message, { reply_markup: keyboard, parse_mode: 'Markdown' })
    .then(sent => {
      // Save the messageId, this is CRITICAL for the single-message UI
      userStates.set(chatId, { step: 'AWAITING_CLASS', messageId: sent.message_id });
    });
}

// --- Commands ---
bot.onText(/\/start/, (msg) => {
  // Clear any old state before starting
  userStates.delete(msg.chat.id);
  startBot(msg.chat.id);
});

// --- Callback Handler (Button Presses) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [type, value] = query.data.split(':');
  const state = userStates.get(chatId);
  
  // Always answer the callback query to stop the "loading" icon
  await bot.answerCallbackQuery(query.id).catch(() => {});

  if (!state) return; // No state, do nothing

  // --- Main State Machine (Callbacks) ---

  // 1. CLASS chosen
  if (type === 'class' && state.step === 'AWAITING_CLASS') {
    state.class = value;
    state.step = 'AWAITING_SUBJECT';
    userStates.set(chatId, state);

    const text = buildProgressText(state, 'Step 2 — Please select the *Subject*:');
    const keyboard = buildInlineKeyboard(subjects, 'subject');
    await updateBotMessage(chatId, state, text, keyboard);
    return;
  }

  // 2. SUBJECT chosen
  if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
    state.subject = value;
    state.step = 'AWAITING_TEACHER';
    userStates.set(chatId, state);

    const text = buildProgressText(state, "Step 3 — Got it! Now, what's the *Teacher's Name*?");
    await updateBotMessage(chatId, state, text); // No keyboard, awaiting text
    return;
  }

  // 4. HW yes/no choice
  if (type === 'hasHW' && state.step === 'AWAITING_HW_CONFIRM') {
    if (value === 'yes') {
      // User has HW
      state.step = 'AWAITING_HW';
      userStates.set(chatId, state);
      
      const text = buildProgressText(state, "OK — Please send the *Homework (HW)* text:");
      await updateBotMessage(chatId, state, text);
    } else {
      // User has NO HW
      state.hw = '';
      state.remarks = '';
      state.step = 'GENERATE_NO_HW';
      userStates.set(chatId, state);
      
      // Call the API for "no homework"
      await updateBotMessage(chatId, state, '👍 Got it! No homework.');
      await generateImageAndSend(chatId, state, false); // false = no HW
      userStates.delete(chatId); // Clean up state
    }
    return;
  }

  // 5. Restart button
  if (type === 'restart') {
    userStates.delete(chatId);
    await bot.deleteMessage(chatId, state.messageId).catch(()=>{}); // Delete old message
    startBot(chatId); // Start fresh
    return;
  }
});

// --- Message Handler (Text Replies) ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands
  if (!text || text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state || !state.step || !state.messageId) {
    // If no flow started, ignore random text
    return;
  }

  // --- Auto-delete user's reply (Suggestion #4) ---
  bot.deleteMessage(chatId, msg.message_id).catch(()=>{});

  // --- Main State Machine (Text) ---
  switch (state.step) {
    
    // 3. Waiting for TEACHER
    case 'AWAITING_TEACHER':
      state.teacher = text;
      state.step = 'AWAITING_CW';
      userStates.set(chatId, state);
      
      const text_cw = buildProgressText(state, "Step 4 — Great! What was the *Classwork (CW)*?");
      await updateBotMessage(chatId, state, text_cw);
      break;

    // 4. Waiting for CW
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
      const text_hw_q = buildProgressText(state, "Step 5 — Do you have *Homework (HW)*?");
      await updateBotMessage(chatId, state, text_hw_q, keyboard);
      break;

    // 5. Waiting for HW
    case 'AWAITING_HW':
      state.hw = text;
      state.step = 'AWAITING_REMARKS';
      userStates.set(chatId, state);
      
      const text_remarks = buildProgressText(state, "Last step! Any *Remarks*? (Type 'none' if empty)");
      await updateBotMessage(chatId, state, text_remarks);
      break;

    // 6. Waiting for REMARKS
    case 'AWAITING_REMARKS':
      state.remarks = (text && text.toLowerCase() === 'none') ? '' : text;
      state.step = 'GENERATE_HW';
      userStates.set(chatId, state);

      // All inputs collected: call generate-hw
      await updateBotMessage(chatId, state, '✅ All done!');
      await generateImageAndSend(chatId, state, true); // true = has HW
      userStates.delete(chatId); // Clean up state
      break;
  }
});

// --- Image generation helper (No changes needed, it's perfect) ---
async function generateImageAndSend(chatId, state, hasHW) {
  try {
    // Edit the main message to show "Generating..."
    await updateBotMessage(chatId, state, '🎨 Generating your diary image... Please wait.');

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
    
    // Fetch the image
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Build the caption
    const captionParts = [
      `✅ Diary generated successfully!`,
      `📚 Subject: ${state.subject}`,
      `👩‍🏫 Teacher: ${state.teacher}`,
      `✏️ CW: ${state.cw}`
    ];
    if (hasHW) captionParts.push(`📘 HW: ${state.hw}`, `🗒️ Remarks: ${state.remarks || '—'}`);
    
    // We must delete the "Single Message" first, because sendPhoto is a *new* message
    await bot.deleteMessage(chatId, state.messageId).catch(() => {});

    // Send the final photo
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
    // Offer restart on failure
    const keyboard = { inline_keyboard: [[{ text: '🔁 Try again', callback_data: 'restart' }]] };
    await bot.sendMessage(chatId, 'Would you like to start over?', { reply_markup: keyboard });
  } finally {
    // Ensure state is always cleared after a generation attempt
    userStates.delete(chatId);
  }
}
