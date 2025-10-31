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
const ADMIN_CHAT_ID = '1928349457'; // <-- Your ID for logging

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

console.log('📗 Bot started successfully... (Multi-Message Cleanup + Logging Version)');

// --- Helper Functions ---

/** Builds the inline keyboard */
function buildInlineKeyboard(items, type) {
  const buttons = items.map(item =>
    [{ text: typeof item === 'object' ? item.text : item, callback_data: `${type}:${typeof item === 'object' ? item.value : item}` }]
  );
  return { inline_keyboard: buttons };
}

/** Starts the entire flow */
async function startBot(chatId) {
  const message = '📝 *Welcome to the Diary Maker!*\n\nStep 1 — Please select your *Class*:';
  const keyboard = buildInlineKeyboard(classes, 'class');
  
  try {
    const sent = await bot.sendMessage(chatId, message, { reply_markup: keyboard, parse_mode: 'Markdown' });
    // Initialize state with the first message to delete
    userStates.set(chatId, { 
      step: 'AWAITING_CLASS', 
      messagesToDelete: [sent.message_id] 
    });
  } catch (e) {
    console.error('Error starting bot:', e);
  }
}

/** * Clean up all messages
 * This is the core of the cleanup flow.
 */
async function cleanupMessages(chatId, state) {
  if (state && state.messagesToDelete) {
    // We use Promise.allSettled to try deleting all, even if some fail
    // (e.g., if a message was already deleted)
    const promises = state.messagesToDelete.map(msgId =>
      bot.deleteMessage(chatId, msgId).catch(() => {}) // Ignore errors
    );
    await Promise.allSettled(promises);
  }
  // Clear the state
  userStates.delete(chatId);
}

// --- Commands ---
bot.onText(/\/start/, (msg) => {
  // Clear any old state before starting
  cleanupMessages(msg.chat.id, userStates.get(msg.chat.id));
  startBot(msg.chat.id);
});

// --- Callback Handler (Button Presses) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [type, value] = query.data.split(':');
  const state = userStates.get(chatId);
  
  await bot.answerCallbackQuery(query.id).catch(() => {});
  if (!state) return; // No state, do nothing

  // The message the button was on
  const originalMessageId = query.message.message_id;

  try {
    // 1. CLASS chosen
    if (type === 'class' && state.step === 'AWAITING_CLASS') {
      state.class = value;
      state.step = 'AWAITING_SUBJECT';

      // Edit the class message to show selection
      await bot.editMessageText(`🎓 *Class:* \`${value}\``, { 
        chat_id: chatId, 
        message_id: originalMessageId, 
        parse_mode: 'Markdown' 
      });

      // Send NEW message for Subject
      const kb = buildInlineKeyboard(subjects, 'subject');
      const sent = await bot.sendMessage(chatId, 'Step 2 — Please select the *Subject*:', { reply_markup: kb });
      state.messagesToDelete.push(sent.message_id);
      userStates.set(chatId, state);
      return;
    }

    // 2. SUBJECT chosen
    if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
      state.subject = value;
      state.step = 'AWAITING_TEACHER';

      // Edit the subject message
      await bot.editMessageText(`📚 *Subject:* \`${value}\``, { 
        chat_id: chatId, 
        message_id: originalMessageId, 
        parse_mode: 'Markdown' 
      });

      // Send NEW message for Teacher
      const sent = await bot.sendMessage(chatId, "Step 3 — Got it! Now, what's the *Teacher's Name*?");
      state.messagesToDelete.push(sent.message_id);
      userStates.set(chatId, state);
      return;
    }

    // 3. HW yes/no choice
    if (type === 'hasHW' && state.step === 'AWAITING_HW_CONFIRM') {
      if (value === 'yes') {
        // User has HW
        state.step = 'AWAITING_HW';
        await bot.editMessageText('✅ *Homework:* Yes', { chat_id: chatId, message_id: originalMessageId, parse_mode: 'Markdown' });
        
        const sent = await bot.sendMessage(chatId, "OK — Please send the *Homework (HW)* text:");
        state.messagesToDelete.push(sent.message_id);
      } else {
        // User has NO HW
        state.hw = '';
        state.remarks = '';
        state.step = 'GENERATE_NO_HW';
        await bot.editMessageText('❌ *Homework:* No', { chat_id: chatId, message_id: originalMessageId, parse_mode: 'Markdown' });
        
        // Call the API for "no homework"
        await generateImageAndSend(chatId, state, false); // false = no HW
      }
      userStates.set(chatId, state);
      return;
    }

    // 4. Restart button
    if (type === 'restart') {
      // Don't clean up here, the /start handler will do it
      // This button just re-triggers the /start logic
      await cleanupMessages(chatId, state);
      startBot(chatId);
      return;
    }
  } catch (e) {
    console.error('Callback error:', e.message);
  }
});

// --- Message Handler (Text Replies) ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state || !state.step) {
    // If no flow started, ignore random text
    return;
  }

  // Add the user's reply to the delete list
  state.messagesToDelete.push(msg.message_id);

  try {
    switch (state.step) {
      
      // 3. Waiting for TEACHER
      case 'AWAITING_TEACHER':
        state.teacher = text;
        state.step = 'AWAITING_CW';
        
        const sent_cw = await bot.sendMessage(chatId, "Step 4 — Great! What was the *Classwork (CW)*?");
        state.messagesToDelete.push(sent_cw.message_id);
        break;

      // 4. Waiting for CW
      case 'AWAITING_CW':
        state.cw = text;
        state.step = 'AWAITING_HW_CONFIRM';

        const keyboard = {
          inline_keyboard: [
            [{ text: '✅ Yes', callback_data: 'hasHW:yes' }, { text: '❌ No', callback_data: 'hasHW:no' }]
          ]
        };
        const sent_hw_q = await bot.sendMessage(chatId, 'Step 5 — Do you have *Homework (HW)*?', { reply_markup: keyboard });
        state.messagesToDelete.push(sent_hw_q.message_id);
        break;

      // 5. Waiting for HW
      case 'AWAITING_HW':
        state.hw = text;
        state.step = 'AWAITING_REMARKS';
        
        const sent_remarks = await bot.sendMessage(chatId, "Last step! Any *Remarks*? (Type 'none' if empty)");
        state.messagesToDelete.push(sent_remarks.message_id);
        break;

      // 6. Waiting for REMARKS
      case 'AWAITING_REMARKS':
        state.remarks = (text && text.toLowerCase() === 'none') ? '' : text;
        state.step = 'GENERATE_HW';
        
        // All inputs collected: call generate-hw
        await generateImageAndSend(chatId, state, true); // true = has HW
        break;
    }
  } catch (e) {
    console.error('Message handler error:', e.message);
  }

  // Save state after changes
  if (userStates.has(chatId)) {
      userStates.set(chatId, state);
  }
});

// --- Image generation helper ---
async function generateImageAndSend(chatId, state, hasHW) {
  
  // --- ✨ NEW LOGGING BLOCK ---
  try {
    const logMessage = `
🔔 *New Diary Generation* 🔔
-------------------------
🎓 *Class:* \`${state.class}\`
📚 *Subject:* \`${state.subject}\`
👩‍🏫 *Teacher:* \`${state.teacher}\`
    `;
    
    // Send the log message to your admin ID
    bot.sendMessage(ADMIN_CHAT_ID, logMessage, { parse_mode: 'Markdown' })
      .catch(err => {
        // Log this error, but don't stop the user's diary
        console.error('Failed to send log message to admin:', err.message);
      });
  } catch (logErr) {
    console.error('Critical error in logging block:', logErr);
  }
  // --- ✨ END NEW LOGGING BLOCK ---

  let generatingMessage;
  try {
    // Send "Generating..." and add it to the delete list
    generatingMessage = await bot.sendMessage(chatId, '🎨 Generating your diary image... Please wait.');
    state.messagesToDelete.push(generatingMessage.message_id);

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
    
    // Send the final photo (This message STAYS)
    await bot.sendPhoto(chatId, imageBuffer, {
      caption: captionParts.join('\n'),
      parse_mode: 'Markdown'
    });

    // Offer restart (This message STAYS)
    const keyboard = { inline_keyboard: [[{ text: '🔁 Create another diary', callback_data: 'restart' }]] };
    await bot.sendMessage(chatId, 'Would you like to create another?', { reply_markup: keyboard });

  } catch (err) {
    console.error('Error generating diary image:', err && err.message ? err.message : err);
    await bot.sendMessage(chatId, '⚠️ Failed to generate diary. Please try again.');
    // Offer restart on failure
    const keyboard = { inline_keyboard: [[{ text: '🔁 Try again', callback_data: 'restart' }]] };
    await bot.sendMessage(chatId, 'Would you like to start over?', { reply_markup: keyboard });
  } finally {
    // Clean up ALL tracked messages
    await cleanupMessages(chatId, state);
  }
}
