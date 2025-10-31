// Load environment variables from .env file
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios'); // Import axios for making HTTP requests

// Get the bot token from the environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set.');
  console.log('Please create a .env file and add your bot token.');
  process.exit(1);
}

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// In-memory storage for user states
const userStates = new Map();

// --- Define your data ---
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
  'Music',
  'Bangla',
  'Art & Craft',
  'Value Education',
  'English',
  'Mathematics',
  'Science',
  'Global English',
  'Physics',
  'BGST',
  'ICT',
  'Chemistry',
  'Biology',
  'Primary English',
  'Mathematics D',
  'Mathematics Additional',
  'Global Citizenship',
  'Global Perspective',
  'Global Perspective & Global Citizenship',
];

// REMOVED: Teachers array is no longer needed

console.log('Bot started successfully...');

// --- Helper Function to Build Keyboards ---
function buildInlineKeyboard(items, type) {
  const buttons = items.map(item => {
    if (typeof item === 'object') {
      return [{ text: item.text, callback_data: `${type}:${item.value}` }];
    }
    return [{ text: item, callback_data: `${type}:${item}` }];
  });
  return {
    inline_keyboard: buttons,
  };
}

// --- Reusable Start Function ---
function startBot(chatId) {
  const welcomeMessage = '📝 **Welcome to the Diary Maker!**\n\nLet\'s create a new entry. Please select your class:';
  const keyboard = buildInlineKeyboard(classes, 'class');

  bot.sendMessage(chatId, welcomeMessage, { 
      reply_markup: keyboard,
      parse_mode: 'Markdown' 
    })
    .then(sentMessage => {
      userStates.set(chatId, {
        step: 'AWAITING_CLASS',
        messageId: sentMessage.message_id,
      });
    })
    .catch(err => {
      console.error(`Error sending start message to chat ${chatId}:`, err.message);
    });
}

// --- Bot Command Handlers ---

// Handle the /start command
bot.onText(/\/start/, (msg) => {
  startBot(msg.chat.id);
});

// --- Bot Callback Query Handler (Button Clicks) ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const [type, value] = data.split(':');

  const state = userStates.get(chatId);
  if (!state) {
    bot.answerCallbackQuery(query.id);
    return;
  }

  bot.answerCallbackQuery(query.id);

  if (type === 'class' && state.step === 'AWAITING_CLASS') {
    state.class = value;
    state.step = 'AWAITING_SUBJECT';
    userStates.set(chatId, state);

    const subjectMessage = `🎓 **Class:** ${value}\n\nPerfect! Now, please select the subject:`;
    const keyboard = buildInlineKeyboard(subjects, 'subject');

    bot.editMessageText(subjectMessage, {
      chat_id: chatId,
      message_id: state.messageId,
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    });
  } else if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
    state.subject = value;
    state.step = 'AWAITING_CW';
    userStates.set(chatId, state);

    const cwMessage = `🎓 **Class:** ${state.class}\n📚 **Subject:** ${value}\n\nGot it. Now, please send the **Classwork (CW)** as a message:`;

    bot.editMessageText(cwMessage, {
      chat_id: chatId,
      message_id: state.messageId,
      parse_mode: 'Markdown'
    });
  }
  // REMOVED: The 'teacher' callback logic
});

// --- Bot Message Handler (Text Inputs) ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text === '/start') {
    return; // Handled by other listeners
  }

  const state = userStates.get(chatId);

  if (!state && !text.startsWith('/')) {
    startBot(chatId);
    return;
  }

  if (!state || !state.step) {
    return;
  }

  // We'll store the original message ID to edit it later
  const messageToEditId = state.messageId || msg.message_id;

  switch (state.step) {
    case 'AWAITING_CW':
      state.cw = text;
      state.step = 'AWAITING_TEACHER'; // Go to next text step
      userStates.set(chatId, state);

      // CHANGED: Ask for teacher's name as text
      const teacherMessage = `🎓 **Class:** ${state.class}\n📚 **Subject:** ${state.subject}\n✍️ **CW:** ${text}\n\nAlmost done! Please send the **Teacher's Name**:`;
      
      bot.editMessageText(teacherMessage, {
        chat_id: chatId,
        message_id: messageToEditId, 
        parse_mode: 'Markdown'
        // No reply_markup
      });

      // Keep track of the message we just edited
      state.messageId = (await bot.getChat(chatId)).message_id || messageToEditId;

      // Delete the user's CW message to keep the chat clean
      bot.deleteMessage(chatId, msg.message_id).catch(err => {
         console.warn(`Failed to delete user message: ${err.message}`);
      });
      break;

    // NEW: Handle teacher text input
    case 'AWAITING_TEACHER':
      state.teacher = text;

      // Delete the user's teacher name message
      bot.deleteMessage(chatId, msg.message_id).catch(err => {
         console.warn(`Failed to delete user message: ${err.message}`);
      });

      // Show "Generating" message
      await bot.editMessageText('🎨 **Generating your diary...**\n\nPlease wait a moment.', {
        chat_id: chatId,
        message_id: messageToEditId,
        parse_mode: 'Markdown'
      });

      // Build the URL
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw,
        hw: 'N/A', 
        remarks: 'N/A',
        teacher: state.teacher,
      });

      const finalUrl = `https://blu.com.bd/generate?${params.toString()}`;

      try {
        const response = await axios.get(finalUrl, {
          responseType: 'arraybuffer',
        });

        const imageBuffer = Buffer.from(response.data, 'binary');

        await bot.sendPhoto(chatId, imageBuffer, {
          caption: `Here's your custom diary entry! ✨\n\n**Subject:** ${state.subject}\n**Teacher:** ${state.teacher}`,
          parse_mode: 'Markdown'
        });
        
        await bot.editMessageText('✅ **Done!**\n\nReady for the next one? Just type /start.', {
           chat_id: chatId,
           message_id: messageToEditId,
           parse_mode: 'Markdown'
        });

      } catch (error) {
        console.error('Error fetching image:', error.message);
        await bot.editMessageText('⚠️ **Oops! Something went wrong.**\n\nI couldn\'t generate the diary image. Please try again.', {
           chat_id: chatId,
           message_id: messageToEditId,
           parse_mode: 'Markdown'
        });
        await bot.sendMessage(chatId, `You can try the link manually: ${finalUrl}`);
      }

      // Clear the state for this user
      userStates.delete(chatId);
      break;
  }
});
