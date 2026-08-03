import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { config, assertConfig } from './config.js';
import { createSttProvider } from './stt/index.js';
import { SessionManager } from './recorder/SessionManager.js';
import { formatTranscript } from './transcript/formatter.js';
import { formatOffset, formatFileTimestamp } from './utils/time.js';

assertConfig();

const sttProvider = createSttProvider();
const sessions = new SessionManager(sttProvider);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once('clientReady', () => {
  console.log(`已登入：${client.user.tag}，STT 引擎：${sttProvider.name}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'record') return;

  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'start') await handleStart(interaction);
    else if (sub === 'stop') await handleStop(interaction);
    else if (sub === 'status') await handleStatus(interaction);
  } catch (err) {
    console.error('[command] 執行失敗:', err);
    const payload = { content: `發生錯誤：${err.message}` };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

async function handleStart(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: '請先加入一個語音頻道，再使用 /record start',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();
  await sessions.start(voiceChannel);
  await interaction.editReply(
    `🔴 開始錄音「${voiceChannel.name}」，使用 /record stop 結束並產生逐字稿。`,
  );
}

async function handleStop(interaction) {
  await interaction.deferReply();
  // 立即停止擷取並離開頻道；辨識在錄音期間已即時排隊進行
  const session = sessions.stop(interaction.guildId);

  const progressText = () =>
    `⏹️ 錄音結束，辨識完成 ${session.doneCount}/${session.sttJobs.length} 批，整理中...`;
  await interaction.editReply(progressText());
  const ticker = setInterval(() => {
    interaction.editReply(progressText()).catch(() => {});
  }, 5000);

  try {
    await session.finalize();
  } finally {
    clearInterval(ticker);
  }
  const transcript = formatTranscript(session, sttProvider.name);

  // 存檔
  const dir = path.resolve(config.transcriptDir);
  await fs.mkdir(dir, { recursive: true });
  const filename = `transcript-${formatFileTimestamp(session.startedAt)}.md`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, transcript, 'utf8');
  console.log(`[transcript] 已輸出 ${filePath}`);

  const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
    name: filename,
  });
  const payload = {
    content: `⏹️ 錄音結束，共 ${session.segments.length} 段發言，逐字稿如下：`,
    files: [attachment],
  };
  // 辨識若拖超過 15 分鐘，interaction token 會失效，改用頻道訊息送出
  try {
    await interaction.editReply(payload);
  } catch {
    await interaction.channel.send(payload);
  }
}

async function handleStatus(interaction) {
  const session = sessions.get(interaction.guildId);
  if (!session) {
    await interaction.reply({
      content: '目前沒有進行中的錄音',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const elapsed = formatOffset(Date.now() - session.startedAt.getTime());
  await interaction.reply({
    content:
      `🔴 錄音中（${session.voiceChannel.name}）\n` +
      `已錄製：${elapsed}\n` +
      `已收到段落：${session.segments.length}（辨識中：${session.activeUsers.size} 人發言中）`,
    flags: MessageFlags.Ephemeral,
  });
}

client.login(config.discordToken);
