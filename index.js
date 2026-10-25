const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ApplicationIntegrationType, 
    InteractionContextType,
    EmbedBuilder 
} = require('discord.js');
require('dotenv').config();
const http = require('http');

// 1. Discordクライアントの初期化 (メッセージを読むためのインテントが必須！)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

// 2. コマンド定義
const commands = [
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('メッセージやメンバーを検索・取得します')
        .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('現在のチャンネルからメッセージをキーワード検索します')
                .addStringOption(opt => opt.setName('query').setDescription('検索したいキーワード').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('member')
                .setDescription('メンバーの情報を取得します')
                .addUserOption(opt => opt.setName('user').setDescription('対象のユーザーを選択').setRequired(true))
        ),

    // メッセージ右クリックメニュー
    {
        name: 'メッセージ詳細取得',
        type: 3,
        integration_types: [0, 1],
        contexts: [0, 1, 2]
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    try {
        console.log(`🤖 ログインしました: ${client.user.tag}`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✨ アプリケーションコマンドの登録が完了しました！');
    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

// 3. インタラクション受信処理（検索の実装）
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, channel, guild } = interaction;

    if (commandName === 'search') {
        const subcommand = options.getSubcommand();
        await interaction.deferReply({ flags: 64 }); // 自分だけに見えるように一時停止

        try {
            // --- メッセージ検索 ---
            if (subcommand === 'message') {
                const query = options.getString('query');
                
                // チャンネル内の直近メッセージを取得してキーワードでフィルタリング
                const messages = await channel.messages.fetch({ limit: 100 });
                const matched = messages.filter(m => m.content.includes(query));

                if (matched.size === 0) {
                    return interaction.editReply(`🔍 "${query}" に一致するメッセージは見つかりませんでした（直近100件中）。`);
                }

                let resultText = `🔍 **"${query}" の検索結果 (直近の該当メッセージ)**:\n\n`;
                let count = 0;
                for (const [id, msg] of matched) {
                    if (count >= 5) break; // 最大5件まで表示
                    resultText += `・ **${msg.author.tag}**: ${msg.content} ([ジャンプ](${msg.url}))\n`;
                    count++;
                }

                await interaction.editReply(resultText);
            }

            // --- メンバー検索 ---
            else if (subcommand === 'member') {
                const user = options.getUser('user');
                const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;

                const embed = new EmbedBuilder()
                    .setTitle(`👤 ユーザー情報: ${user.tag}`)
                    .setThumbnail(user.displayAvatarURL())
                    .setColor(0x00AAFF)
                    .addFields(
                        { name: 'ID', value: user.id, inline: true },
                        { name: 'アカウント作成日', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
                    );

                if (member) {
                    embed.addFields(
                        { name: 'サーバー参加日', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '不明', inline: true }
                    );
                }

                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error(error);
            await interaction.editReply(`⚠️ 検索中にエラーが発生しました: ${error.message}`);
        }
    }
});

// 4. Render対策 HTTPサーバー
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT, () => {
    console.log(`🌐 HTTP Server is listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
