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
  const welcomeMessage = 'Welcome to the diary making page. Please select your class:';
  const keyboard = buildInlineKeyboard(classes, 'class');

  bot.sendMessage(chatId, welcomeMessage, { reply_markup: keyboard })
    .then(sentMessage => {
      userStates.set(chatId, {
        step: 'AWAITING_CLASS',
        messageId: sentMessage.message_id,
      });
    })
    .catch(err => {
      // Handle potential errors, e.g., if user blocked the bot
      console.error(`Error sending start message to chat ${chatId}:`, err.message);
    });
}

// --- Bot Command Handlers ---

// Handle the /start command
bot.onText(/\/start/, (msg) => {
  startBot(msg.chat.id);
});

// --- Bot Callback Query Handler (Button Clicks) ---
bot.on('callback_query', (query) => {
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

    const subjectMessage = 'Great! Now select your subject:';
    const keyboard = buildInlineKeyboard(subjects, 'subject');

    bot.editMessageText(subjectMessage, {
      chat_id: chatId,
      message_id: state.messageId,
      reply_markup: keyboard,
    });
  } else if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
    state.subject = value;
    state.step = 'AWAITING_CW';
    userStates.set(chatId, state);

    bot.editMessageText('Got it. Please enter your CW (Classwork):', {
      chat_id: chatId,
      message_id: state.messageId,
    });
  }
});

// --- Bot Message Handler (Text Inputs) ---
// We make this function 'async' to use 'await' for the image download
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // If no text (e.g., sticker, photo), do nothing
  if (!text) {
    return;
  }
  
  // If the message is /start, the onText handler will take care of it
  if (text === '/start') {
    return;
  }

  const state = userStates.get(chatId);

  // If user has no state and sent a non-command message, start the bot
  if (!state && !text.startsWith('/')) {
    startBot(chatId);
    return;
  }

  // If state is invalid or has no step, do nothing
  if (!state || !state.step) {
    return;
  }

  switch (state.step) {
    case 'AWAITING_CW':
      state.cw = text;
      state.step = 'AWAITING_REMARKS';
      userStates.set(chatId, state);
      bot.sendMessage(chatId, 'Please enter any remarks:');
      break;

    case 'AWAITING_REMARKS':
      state.remarks = text;
      state.step = 'AWAITING_TEACHER';
      userStates.set(chatId, state);
      bot.sendMessage(chatId, "Almost done! Please enter the teacher's name:");
      break;

    case 'AWAITING_TEACHER':
      state.teacher = text;

      // Let the user know we're working on it
      await bot.sendMessage(chatId, 'Generating your diary, please wait...');

      // Build the URL
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw,
        hw: 'N/A', // Hardcoded as per your request
        remarks: state.remarks,
        teacher: state.teacher,
      });

      const finalUrl = `https://blu.com.bd/generate?${params.toString()}`;

      try {
        // --- NEW: Download the image ---
        // We set responseType to 'arraybuffer' to get the image data
        const response = await axios.get(finalUrl, {
          responseType: 'arraybuffer',
        });

        // Convert the downloaded data into a Buffer
        const imageBuffer = Buffer.from(response.data, 'binary');

        // Send the image as a photo
        await bot.sendPhoto(chatId, imageBuffer, {
          caption: 'Here is your diary entry!',
        });

      } catch (error) {
        // Handle errors (e.g., website is down, URL is wrong)
        console.error('Error fetching image:', error.message);
        await bot.sendMessage(chatId, 'Sorry, I couldn\'t generate the diary image. Please check the API or try again.');
        // Optionally, send the link as a fallback
        await bot.sendMessage(chatId, `You can try the link manually: ${finalUrl}`);
      }

      // Clear the state for this user
      userStates.delete(chatId);
      break;
  }
});
