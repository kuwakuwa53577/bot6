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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

// コマンド定義
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

        // --- 1分ごとの自動取得・投稿タスク ---
        const targetChannelId = process.env.TARGET_CHANNEL_ID;
        if (targetChannelId) {
            console.log('⏳ 1分間隔のサーバー自動取得・投稿タスクを開始します...');
            
            setInterval(async () => {
                try {
                    const channel = await client.channels.fetch(targetChannelId).catch(() => null);
                    if (!channel) return;

                    // 1. 外部の公開サーバーリスト（招待URL付き）を自動フェッチ
                    // ※ ここはご自身が用意した外部JSONのURL、または公開リストのURLに変更できます
                    const response = await fetch('https://raw.githubusercontent.com/your-username/your-repo/main/servers.json').catch(() => null);
                    
                    let servers = [];
                    if (response && response.ok) {
                        servers = await response.json();
                    } else {
                        // 万が一外部APIに繋がらない場合のフォールバック（動作確認用サンプル）
                        servers = [
                            { name: '自動取得テストサーバー', url: 'https://discord.gg/example' }
                        ];
                    }

                    // 2. リストからランダムに1つピックアップ
                    const randomServer = servers[Math.floor(Math.random() * servers.length)];
                    if (!randomServer || !randomServer.url) return;

                    // 3. Discord公式APIで、未加入サーバーであっても招待URLから詳細情報を取得
                    let inviteInfo;
                    try {
                        inviteInfo = await client.fetchInvite(randomServer.url);
                    } catch (e) {
                        inviteInfo = null;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`🌐 自動ピックアップ: ${randomServer.name}`)
                        .setColor(0x5865F2)
                        .setTimestamp();

                    if (inviteInfo && inviteInfo.guild) {
                        embed.setDescription(`**[${inviteInfo.guild.name}](${randomServer.url})** の招待リンクを自動取得しました！\n\n参加はこちら 👉 ${randomServer.url}`)
                             .setThumbnail(inviteInfo.guild.iconURL({ dynamic: true }))
                             .addFields(
                                 { name: 'サーバー名', value: inviteInfo.guild.name, inline: true },
                                 { name: 'メンバー数', value: `${inviteInfo.memberCount || '不明'} 人`, inline: true }
                             );
                    } else {
                        embed.setDescription(`**${randomServer.name}** の招待リンクをお届けします！\n\n参加はこちら 👉 ${randomServer.url}`);
                    }

                    await channel.send({ embeds: [embed] });
                    console.log(`✨ サーバーの招待URLを自動投稿しました: ${randomServer.name}`);

                } catch (err) {
                    console.error('1分定期投稿エラー:', err.message);
                }
            }, 60 * 1000); // 60,000ms = 1分
        } else {
            console.log('⚠️ TARGET_CHANNEL_ID が設定されていないため、自動投稿はスキップされます。');
        }

    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

// インタラクション受信処理（検索コマンド等）
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, channel, guild } = interaction;

    if (commandName === 'search') {
        const subcommand = options.getSubcommand();
        await interaction.deferReply({ flags: 64 });

        try {
            if (subcommand === 'message') {
                const query = options.getString('query');
                const messages = await channel.messages.fetch({ limit: 100 });
                const matched = messages.filter(m => m.content.includes(query));

                if (matched.size === 0) {
                    return interaction.editReply(`🔍 "${query}" に一致するメッセージは見つかりませんでした（直近100件中）。`);
                }

                let resultText = `🔍 **"${query}" の検索結果 (直近の該当メッセージ)**:\n\n`;
                let count = 0;
                for (const [id, msg] of matched) {
                    if (count >= 5) break;
                    resultText += `・ **${msg.author.tag}**: ${msg.content} ([ジャンプ](${msg.url}))\n`;
                    count++;
                }

                await interaction.editReply(resultText);
            }
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
                        { name: 'サーバー情報（参加日）', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '不明', inline: true }
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

// チャットに招待リンクが貼られたら自動で展開する機能
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const inviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|com\/invite)\/[a-zA-Z0-9-]+)/g;
    const matches = message.content.match(inviteRegex);
    if (!matches) return;

    const inviteUrl = matches[0];

    try {
        const invite = await client.fetchInvite(inviteUrl);
        if (!invite || !invite.guild) return;

        const embed = new EmbedBuilder()
            .setTitle(`🔗 招待されたサーバー情報`)
            .setDescription(`**[${invite.guild.name}](${inviteUrl})**`)
            .setThumbnail(invite.guild.iconURL({ dynamic: true }))
            .setColor(0x57F287)
            .addFields(
                { name: 'サーバー名', value: invite.guild.name, inline: true },
                { name: 'メンバー数', value: `${invite.memberCount || '不明'} 人`, inline: true }
            )
            .setFooter({ text: `送信者: ${message.author.tag}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } catch (error) {
        // エラー時はスルー
    }
});

// Render対策 HTTPサーバー
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT, () => {
    console.log(`🌐 HTTP Server is listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
