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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// コマンド定義
const commands = [
    // 1. /search コマンド (message / member)
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('メッセージやメンバーを検索・取得します')
        .setIntegrationTypes([
            ApplicationIntegrationType.UserInstall, 
            ApplicationIntegrationType.GuildInstall
        ])
        .setContexts([
            InteractionContextType.Guild, 
            InteractionContextType.BotDM, 
            InteractionContextType.PrivateChannel
        ])
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('メッセージを検索またはID指定で取得')
                .addStringOption(opt => 
                    opt.setName('query')
                       .setDescription('検索キーワード、添付ファイルの拡張子、またはメッセージID')
                       .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('member')
                .setDescription('メンバーを検索')
                .addUserOption(opt => 
                    opt.setName('user')
                       .setDescription('対象のユーザーを選択')
                       .setRequired(true)
                )
        ),

    // 2. /ai コマンド (AIに質問)
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('AIに質問します（複数APIキー自動ローテーション対応）')
        .setIntegrationTypes([
            ApplicationIntegrationType.UserInstall, 
            ApplicationIntegrationType.GuildInstall
        ])
        .setContexts([
            InteractionContextType.Guild, 
            InteractionContextType.BotDM, 
            InteractionContextType.PrivateChannel
        ])
        .addStringOption(opt => 
            opt.setName('prompt')
               .setDescription('AIへの質問内容')
               .setRequired(true)
        ),

    // 3. メッセージ右クリックメニュー
    {
        name: 'メッセージ詳細取得',
        type: 3, // ApplicationCommandType.Message
        integration_types: [0, 1],
        contexts: [0, 1, 2]
    }
];

// 起動時にコマンドをDiscordへ登録
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// 起動時にコマンド登録と「利用可能なモデル一覧」の確認を行う
client.once('ready', async () => {
    try {
        console.log(`🤖 ログインしました: ${client.user.tag}`);
        
        // --- 1. 現在のAPIキーで使えるモデルの一覧を取得してログに出す ---
        try {
            const openai = openaiManager.getClient();
            const models = await openai.models.list();
            console.log('📌 【モデル確認】このAPIキーで利用可能なモデル一覧:');
            for (const model of models.data) {
                console.log(`  - ${model.id}`);
            }
        } catch (modelErr) {
            console.error('⚠️ モデル一覧の取得に失敗しました:', modelErr.message);
        }

        // --- 2. コマンド登録 ---
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✨ アプリケーションコマンドの登録が完了しました！');
    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

// インタラクション受信
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        // --- /search コマンドの処理 ---
        if (commandName === 'search') {
            const subcommand = options.getSubcommand();

            if (subcommand === 'member') {
                const targetUser = options.getUser('user');
                const member = interaction.guild ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) : null;

                const embed = new EmbedBuilder()
                    .setTitle(`👤 ユーザー情報: ${targetUser.tag}`)
                    .setThumbnail(targetUser.displayAvatarURL())
                    .addFields(
                        { name: 'ユーザーID', value: targetUser.id, inline: true },
                        { name: 'アカウント作成日時', value: targetUser.createdAt.toDateString(), inline: true }
                    )
                    .setColor(0x00FF00);

                if (member && member.joinedAt) {
                    embed.addFields({ name: 'サーバー参加日時', value: member.joinedAt.toDateString(), inline: true });
                }

                return interaction.reply({ embeds: [embed], flags: 64 });
            }

            if (subcommand === 'message') {
                const query = options.getString('query');
                await interaction.deferReply({ flags: 64 });

                // ① ID検索
                if (/^\d{17,20}$/.test(query)) {
                    try {
                        const targetMsg = await interaction.channel.messages.fetch(query);
                        const embed = createMessageEmbed(targetMsg);
                        return interaction.editReply({ content: 'メッセージが見つかりました！', embeds: [embed] });
                    } catch (e) {
                        // 見つからない場合はキーワード検索へ流す
                    }
                }

                // ② 直近のチャンネルメッセージから検索 (最大100件)
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                const matched = messages.filter(msg => {
                    const hasText = msg.content.toLowerCase().includes(query.toLowerCase());
                    const hasAttachment = msg.attachments.some(att => 
                        att.name.toLowerCase().includes(query.toLowerCase()) || 
                        att.contentType?.includes(query.toLowerCase())
                    );
                    return hasText || hasAttachment;
                });

                if (matched.size === 0) {
                    return interaction.editReply({ content: `🔍 "${query}" に一致するメッセージが直近100件の中に見つかりませんでした。` });
                }

                const embeds = matched.first(3).map(msg => createMessageEmbed(msg));
                return interaction.editReply({ 
                    content: `🔍 **"${query}"** の検索結果 (${matched.size}件中ヒットした上位を表示):`, 
                    embeds 
                });
            }
        }

        // --- /ai コマンドの処理 ---
        if (commandName === 'ai') {
            const prompt = options.getString('prompt');
            await interaction.deferReply(); // 思考中表示

            try {
                const completion = await openaiManager.safeRequest(async (openai) => {
                    return await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: 'あなたは親切なDiscordのボットアシスタントです。' },
                            { role: 'user', content: prompt }
                        ],
                    });
                });

                const answer = completion.choices[0].message.content;
                
                if (answer.length > 2000) {
                    return interaction.editReply(answer.substring(0, 1990) + '...');
                }
                await interaction.editReply(answer);

            } catch (error) {
                console.error(error);
                await interaction.editReply('⚠️ AIの処理中にエラーが発生しました。すべてのAPIキーが制限に達しているか、設定に問題があります。');
            }
        }
    }

    // --- メッセージ右クリックメニューの処理 ---
    if (interaction.isMessageContextMenuCommand()) {
        const message = interaction.targetMessage;
        const embed = createMessageEmbed(message);
        return interaction.reply({ embeds: [embed], flags: 64 });
    }
});

// メッセージ用 Embed 作成ヘルパー
function createMessageEmbed(msg) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL() })
        .setDescription(msg.content || '* (本文なし) *')
        .addFields(
            { name: 'メッセージID', value: msg.id, inline: true },
            { name: '送信日時', value: msg.createdAt.toLocaleString(), inline: true },
            { name: 'リンク', value: `[メッセージへ移動](${msg.url})`, inline: false }
        )
        .setColor(0x3498DB);

    if (msg.attachments.size > 0) {
        const firstAttachment = msg.attachments.first();
        if (firstAttachment.contentType?.startsWith('image/')) {
            embed.setImage(firstAttachment.url);
        } else {
            embed.addFields({ name: '添付ファイル', value: firstAttachment.url });
        }
    }

    return embed;
}

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
