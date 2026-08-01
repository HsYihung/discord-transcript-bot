import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config, assertConfig } from './config.js';

const commands = [
  new SlashCommandBuilder()
    .setName('record')
    .setDescription('語音逐字稿錄音')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('讓 bot 加入你所在的語音頻道並開始錄音'),
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('停止錄音並產生逐字稿'),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('查看目前錄音狀態'),
    )
    .toJSON(),
];

assertConfig();
const rest = new REST({ version: '10' }).setToken(config.discordToken);

const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

const data = await rest.put(route, { body: commands });
console.log(
  `已註冊 ${data.length} 個指令（${config.guildId ? `guild ${config.guildId}` : '全域'}）`,
);
