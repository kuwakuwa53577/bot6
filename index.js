const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    ApplicationIntegrationType, 
    InteractionContextType 
} = require('discord.js');
require('dotenv').config();
const http = require('http');

// 1. Discordクライアントの初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// 2. コマンド定義（検索機能のみ）
const commands = [
    // /search コマンド
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('メッセージやメンバーを検索・取得します')
        .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('メッセージを検索またはID指定で取得')
                .addStringOption(opt => opt.setName('query').setDescription('検索キーワード、拡張子、またはメッセージID').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('member')
                .setDescription('メンバーを検索')
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

// 3. 起動時処理
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

// 4. インタラクション受信処理（必要に応じて検索の処理を追加・維持）
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'search') {
            const subcommand = options.getSubcommand();
            await interaction.reply({ content: `検索機能 (${subcommand}) が呼び出されました！`, flags: 64 });
        }
    }
});

// 5. RenderのWeb Service対策用 HTTP サーバー
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT, () => {
    console.log(`🌐 HTTP Server is listening on port ${PORT}`);
});

// 6. ボット起動
client.login(process.env.DISCORD_TOKEN);
