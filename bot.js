// Load environment variables from .env file
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

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
// For a production VPS, you might consider a simple database
const userStates = new Map();

// --- Define your data ---
// We use an array of objects for classes to have a user-friendly
// button text and a specific value for the URL.
const classes = [
  { text: 'STD 1 (Orchid)', value: 'STD.I (Orchid)' },
  { text: 'STD 2', value: 'STD 2' },
  { text: 'STD 3', value: 'STD 3' },
  // Add more classes as needed
];

const subjects = [
  'Art', 'Bangla', 'English', 'Maths',
  // Add more subjects as needed
];

console.log('Bot started successfully...');

// --- Helper Function to Build Keyboards ---
function buildInlineKeyboard(items, type) {
  // 'items' is an array of strings or objects {text, value}
  const buttons = items.map(item => {
    if (typeof item === 'object') {
      // For class buttons
      return [{ text: item.text, callback_data: `${type}:${item.value}` }];
    }
    // For subject buttons
    return [{ text: item, callback_data: `${type}:${item}` }];
  });
  return {
    inline_keyboard: buttons,
  };
}

// --- Bot Command Handlers ---

// Handle the /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const welcomeMessage = 'Welcome to the diary making page. Please select your class:';
  const keyboard = buildInlineKeyboard(classes, 'class');

  bot.sendMessage(chatId, welcomeMessage, { reply_markup: keyboard })
    .then(sentMessage => {
      // Store the user's state and the message ID to edit it later
      userStates.set(chatId, {
        step: 'AWAITING_CLASS',
        messageId: sentMessage.message_id, // Important for editing
      });
    });
});

// --- Bot Callback Query Handler (Button Clicks) ---
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const [type, value] = data.split(':');

  const state = userStates.get(chatId);

  // If we don't have a state for this user, do nothing
  if (!state) {
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Acknowledge the button press
  bot.answerCallbackQuery(query.id);

  if (type === 'class' && state.step === 'AWAITING_CLASS') {
    // --- User selected a class ---
    state.class = value;
    state.step = 'AWAITING_SUBJECT';
    userStates.set(chatId, state);

    const subjectMessage = 'Great! Now select your subject:';
    const keyboard = buildInlineKeyboard(subjects, 'subject');

    // Edit the *original* message to show subject options
    bot.editMessageText(subjectMessage, {
      chat_id: chatId,
      message_id: state.messageId,
      reply_markup: keyboard,
    });
  } else if (type === 'subject' && state.step === 'AWAITING_SUBJECT') {
    // --- User selected a subject ---
    state.subject = value;
    state.step = 'AWAITING_CW';
    userStates.set(chatId, state);

    // Edit the message to ask for CW
    bot.editMessageText('Got it. Please enter your CW (Classwork):', {
      chat_id: chatId,
      message_id: state.messageId,
      // No reply_markup, so the keyboard vanishes
    });
  }
});

// --- Bot Message Handler (Text Inputs) ---
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands
  if (text.startsWith('/')) {
    return;
  }

  const state = userStates.get(chatId);

  // If we're not expecting text, do nothing
  if (!state || !state.step) {
    return;
  }

  switch (state.step) {
    case 'AWAITING_CW':
      // --- User entered CW ---
      state.cw = text;
      state.step = 'AWAITING_REMARKS';
      userStates.set(chatId, state);
      bot.sendMessage(chatId, 'Please enter any remarks:');
      break;

    case 'AWAITING_REMARKS':
      // --- User entered Remarks ---
      state.remarks = text;
      state.step = 'AWAITING_TEACHER';
      userStates.set(chatId, state);
      bot.sendMessage(chatId, "Almost done! Please enter the teacher's name:");
      break;

    case 'AWAITING_TEACHER':
      // --- User entered Teacher's Name ---
      state.teacher = text;

      // All data collected! Build the URL.
      const params = new URLSearchParams({
        class: state.class,
        subject: state.subject,
        cw: state.cw,
        hw: 'N/A', // Hardcoded as per your request
        remarks: state.remarks,
        teacher: state.teacher,
      });

      const finalUrl = `https://blu.com.bd/generate?${params.toString()}`;

      bot.sendMessage(chatId, `All done! Here is your diary link:\n\n${finalUrl}`);

      // Clear the state for this user
      userStates.delete(chatId);
      break;
  }
});
