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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// コマンド定義
const commands = [
    // 1. /search コマンド
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('メッセージやメンバーを検索・取得します')
        .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('メッセージを検索またはID指定で取得')
                .addStringOption(opt => opt.setName('query').setDescription('検索キーワード、添付ファイル拡張子、またはメッセージID').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('member')
                .setDescription('メンバーを検索')
                .addUserOption(opt => opt.setName('user').setDescription('対象のユーザーを選択').setRequired(true))
        ),

    // 2. /ai コマンド (モデル選択付き)
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
           { name: 'Gemini 1.5 Flash (完全無料・要API有効化)', value: 'gemini-1.5-flash' },
           { name: 'OpenAI: gpt-4o', value: 'gpt-4o' },
           { name: 'OpenAI: gpt-4o-mini', value: 'gpt-4o-mini' }
       )
)

    // 3. /models コマンド (利用可能なモデル一覧を表示)
    new SlashCommandBuilder()
        .setName('models')
        .setDescription('現在利用可能なAIモデルの一覧を表示します')
        .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    // 4. メッセージ右クリックメニュー
    {
        name: 'メッセージ詳細取得',
        type: 3,
        integration_types: [0, 1],
        contexts: [0, 1, 2]
    }
];

// 起動時処理
client.once('ready', async () => {
    try {
        console.log(`🤖 ログインしました: ${client.user.tag}`);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✨ アプリケーションコマンドの登録が完了しました！');
    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// インタラクション受信
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // --- /models コマンド ---
        if (commandName === 'models') {
            const embed = new EmbedBuilder()
                .setTitle('📋 利用可能なAIモデル一覧')
                .setColor(0x00AAFF)
                .addFields(
                    { name: '🌟 Google Gemini (完全無料)', value: '`gemini-1.5-flash` (高速・おすすめ)\n`gemini-1.5-pro`', inline: false },
                    { name: '🤖 OpenAI (要APIキー残高)', value: '`gpt-4o`\n`gpt-3.5-turbo`\n`o3-mini`', inline: false }
                )
                .setFooter({ text: '※Geminiは完全無料で利用できます！' });

            return interaction.reply({ embeds: [embed], flags: 64 });
        }

        // --- /ai コマンド ---
        if (commandName === 'ai') {
            const prompt = options.getString('prompt');
            const model = options.getString('model') || 'gemini-1.5-flash'; // デフォルトを無料のGeminiに設定！
            await interaction.deferReply();

            try {
                let answer = '';

                // Geminiの場合
                if (model.startsWith('gemini')) {
                    answer = await callGemini(prompt, model);
                } 
                // OpenAIの場合
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

        // --- /search コマンド等は省略せずそのままここに結合 ---
    }

    // 右クリックメニュー処理などは前回のコードをそのまま維持
});

client.login(process.env.DISCORD_TOKEN);

// --- RenderのWeb Service対策用簡易HTTPサーバー ---
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT, () => {
    console.log(`🌐 HTTP Server is listening on port ${PORT}`);
});
