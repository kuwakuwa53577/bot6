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
const openaiManager = require('./openaiManager');
const { callGemini } = require('./geminiManager');
const http = require('http');

// 1. Discordクライアントの初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// 2. コマンド定義
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

    // /ai コマンド (モデル選択付き)
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('AIに質問します（モデル選択・自動ローテーション対応）')
        .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addStringOption(opt => 
            opt.setName('prompt')
               .setDescription('AIへの質問内容')
               .setRequired(true)
        )
        .addStringOption(opt => 
            opt.setName('model')
               .setDescription('使用するAIモデルを選択')
               .setRequired(false)
               .addChoices(
                   { name: 'Gemini 1.5 Flash (完全無料・おすすめ)', value: 'gemini-1.5-flash' },
                   { name: 'OpenAI: gpt-4o', value: 'gpt-4o' },
                   { name: 'OpenAI: gpt-4o-mini', value: 'gpt-4o-mini' }
               )
        ),

    // /models コマンド
    new SlashCommandBuilder()
        .setName('models')
        .setDescription('利用可能なAIモデルの一覧を表示します')
        .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

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

// 4. インタラクション受信処理
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // /models コマンド
        if (commandName === 'models') {
            const embed = new EmbedBuilder()
                .setTitle('📋 利用可能なAIモデル一覧')
                .setColor(0x00AAFF)
                .addFields(
                    { name: '🌟 Google Gemini (完全無料)', value: '`gemini-1.5-flash` (高速・おすすめ)', inline: false },
                    { name: '🤖 OpenAI (要APIキー残高)', value: '`gpt-4o`\n`gpt-4o-mini`', inline: false }
                )
                .setFooter({ text: '※GeminiはGoogle AI Studioでキーを発行して利用できます！' });

            return interaction.reply({ embeds: [embed], flags: 64 });
        }

        // /ai コマンド
        if (commandName === 'ai') {
            const prompt = options.getString('prompt');
            const model = options.getString('model') || 'gemini-1.5-flash';
            await interaction.deferReply();

            try {
                let answer = '';

                // Gemini の場合
                if (model.startsWith('gemini')) {
                    answer = await callGemini(prompt, model);
                } 
                // OpenAI の場合
                else {
                    const completion = await openaiManager.safeRequest(async (openai) => {
                        return await openai.chat.completions.create({
                            model: model,
                            messages: [
                                { role: 'system', content: 'あなたは親切なDiscordのボットアシスタントです。' },
                                { role: 'user', content: prompt }
                            ],
                        });
                    });
                    answer = completion.choices[0].message.content;
                }
                
                if (answer.length > 2000) {
                    answer = answer.substring(0, 1990) + '...';
                }
                await interaction.editReply(answer);

            } catch (error) {
                console.error(error);
                await interaction.editReply(`⚠️ エラーが発生しました: ${error.message}`);
            }
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
