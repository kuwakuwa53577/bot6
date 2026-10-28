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
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------
// 1. 簡易データ保存（JSONファイル）の設定
// ----------------------------------------------------
const DATA_FILE = path.join(__dirname, 'economy.json');
let economyData = {};

// 起動時にデータを読み込み
if (fs.existsSync(DATA_FILE)) {
    try {
        economyData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        console.error('データファイルの読み込みに失敗しました:', e);
        economyData = {};
    }
}

// データを保存する関数
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(economyData, null, 2));
}

// ユーザーデータの初期化・取得ヘルパー
function getUserData(userId) {
    if (!economyData[userId]) {
        economyData[userId] = {
            balance: 0,
            lastDaily: 0
        };
    }
    return economyData[userId];
}

// ----------------------------------------------------
// 2. Client & コマンド定義
// ----------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

const commands = [
    // ⏰ リマインダーコマンド
    new SlashCommandBuilder()
        .setName('reminder')
        .setDescription('指定した時間後に通知を行います')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
        .addIntegerOption(opt => opt.setName('minutes').setDescription('何分後に通知するか').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('message').setDescription('リマインドするメッセージ').setRequired(true)),

    // 💰 ログインボーナス
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('1日1回コインを獲得できます')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild]),

    // 💳 残高確認
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('現在の所持コイン数を確認します')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
        .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー（未指定で自分）')),

    // 💸 送金
    new SlashCommandBuilder()
        .setName('pay')
        .setDescription('他のメンバーにコインを送金します')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
        .addUserOption(opt => opt.setName('target').setDescription('送金先ユーザー').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('送金額').setRequired(true).setMinValue(1)),

    // 🏆 ランキング
    new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('サーバー内の所持コインランキングを表示します')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild]),

    // 🎰 ガチャ
    new SlashCommandBuilder()
        .setName('gacha')
        .setDescription('100コインでガチャを回します（ロールやアイテムが当たる！）')
        .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
        .setContexts([InteractionContextType.Guild])
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// ----------------------------------------------------
// 3. Bot 起動処理
// ----------------------------------------------------
client.once('clientReady', async () => {
    try {
        console.log(`🤖 ログインしました: ${client.user.tag}`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✨ コマンドの登録が完了しました！');
    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

// ----------------------------------------------------
// 4. インタラクション処理
// ----------------------------------------------------
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, user, guild, channel } = interaction;

    try {
        // ================================================
        // ⏰ /reminder
        // ================================================
        if (commandName === 'reminder') {
            const minutes = options.getInteger('minutes');
            const message = options.getString('message');

            await interaction.reply({
                content: `⏰ **${minutes}分後**に「${message}」とお知らせします！`,
                ephemeral: true
            });

            setTimeout(async () => {
                const embed = new EmbedBuilder()
                    .setTitle('⏰ リマインダー通知')
                    .setDescription(`**${user}** さん、時間になりました！\n\n📝 **内容:** ${message}`)
                    .setColor(0xFF9900)
                    .setTimestamp();

                await channel.send({ content: `${user}`, embeds: [embed] }).catch(() => {});
            }, minutes * 60 * 1000);
        }

        // ================================================
        // 💰 /daily
        // ================================================
        else if (commandName === 'daily') {
            const userData = getUserData(user.id);
            const now = Date.now();
            const cooldown = 24 * 60 * 60 * 1000; // 24時間

            if (now - userData.lastDaily < cooldown) {
                const nextTime = Math.floor((userData.lastDaily + cooldown) / 1000);
                return interaction.reply({
                    content: `⏳ 本日のデイリーボーナスは受取済みです。\n次回受取可能時刻: <t:${nextTime}:R>`,
                    ephemeral: true
                });
            }

            // 100〜300コインをランダム付与
            const reward = Math.floor(Math.random() * 201) + 100;
            userData.balance += reward;
            userData.lastDaily = now;
            saveData();

            const embed = new EmbedBuilder()
                .setTitle('🎁 デイリーボーナス！')
                .setDescription(`**${reward} コイン** を獲得しました！\n💰 現在の所持金: **${userData.balance} コイン**`)
                .setColor(0x00FF7F)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // ================================================
        // 💳 /balance
        // ================================================
        else if (commandName === 'balance') {
            const targetUser = options.getUser('user') || user;
            const userData = getUserData(targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle(`💳 ${targetUser.username} さんの口座`)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields({ name: '所持コイン', value: `**${userData.balance}** コイン` })
                .setColor(0x00AAFF)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // ================================================
        // 💸 /pay
        // ================================================
        else if (commandName === 'pay') {
            const target = options.getUser('target');
            const amount = options.getInteger('amount');

            if (target.id === user.id) {
                return interaction.reply({ content: '⚠️ 自分自身には送金できません。', ephemeral: true });
            }
            if (target.bot) {
                return interaction.reply({ content: '⚠️ Botには送金できません。', ephemeral: true });
            }

            const senderData = getUserData(user.id);
            if (senderData.balance < amount) {
                return interaction.reply({ content: `⚠️ コインが不足しています。（所持: ${senderData.balance} コイン）`, ephemeral: true });
            }

            const targetData = getUserData(target.id);
            senderData.balance -= amount;
            targetData.balance += amount;
            saveData();

            const embed = new EmbedBuilder()
                .setTitle('💸 送金完了')
                .setDescription(`**${user.username}** さんが **${target.username}** さんに **${amount} コイン** を送金しました！`)
                .setColor(0x57F287)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // ================================================
        // 🏆 /ranking
        // ================================================
        else if (commandName === 'ranking') {
            const sorted = Object.entries(economyData)
                .sort(([, a], [, b]) => b.balance - a.balance)
                .slice(0, 10);

            if (sorted.length === 0) {
                return interaction.reply({ content: 'まだ誰データもありません。', ephemeral: true });
            }

            let rankText = '';
            for (let i = 0; i < sorted.length; i++) {
                const [id, data] = sorted[i];
                const member = await guild.members.fetch(id).catch(() => null);
                const name = member ? member.displayName : `ユーザー(${id})`;
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                rankText += `${medal} **${name}**: ${data.balance} コイン\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle('🏆 リッチマンランキング (Top 10)')
                .setDescription(rankText)
                .setColor(0xF1C40F)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // ================================================
        // 🎰 /gacha
        // ================================================
        else if (commandName === 'gacha') {
            const GACHA_COST = 100;
            const userData = getUserData(user.id);

            if (userData.balance < GACHA_COST) {
                return interaction.reply({
                    content: `⚠️ コインが足りません！ガチャを引くには **${GACHA_COST} コイン** 必要です。（所持: ${userData.balance} コイン）`,
                    ephemeral: true
                });
            }

            // コイン消費
            userData.balance -= GACHA_COST;

            // ガチャの排出テーブル定義
            // ★ロールを景品にする場合、対象のロールIDをここに入れてください
            const ROLE_SSR_ID = 'YOUR_SSR_ROLE_ID'; 

            const rand = Math.random() * 100; // 0 ~ 100
            let result = { title: '', desc: '', color: 0x95A5A6 };

            if (rand < 5) {
                // UR: 5% (高額キャッシュバック)
                const bonus = 500;
                userData.balance += bonus;
                result = {
                    title: '🌈 超激レア (UR)！！',
                    desc: `大当たり！超大金の **${bonus} コイン** を獲得しました！`,
                    color: 0xE91E63
                };
            } else if (rand < 20) {
                // SSR: 15% (限定ロール付与)
                result = {
                    title: '🌟 激レア (SSR)！',
                    desc: '「ガチャマスター」の称号（ロール）を獲得しました！',
                    color: 0xF1C40F
                };

                // ロール付与処理（ロールIDが設定されている場合）
                if (ROLE_SSR_ID && ROLE_SSR_ID !== 'YOUR_SSR_ROLE_ID') {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    if (member) await member.roles.add(ROLE_SSR_ID).catch(() => {});
                }
            } else if (rand < 50) {
                // SR: 30% (小額キャッシュバック)
                const bonus = 150;
                userData.balance += bonus;
                result = {
                    title: '✨ レア (SR)',
                    desc: `元取れ！ **${bonus} コイン** を獲得しました！`,
                    color: 0x3498DB
                };
            } else {
                // N: 50% (はずれ)
                result = {
                    title: '⚪ ノーマル (N)',
                    desc: '残念！ポケットティッシュを獲得しました。',
                    color: 0x95A5A6
                };
            }

            saveData();

            const embed = new EmbedBuilder()
                .setTitle(`🎰 ガチャ結果: ${result.title}`)
                .setDescription(`${result.desc}\n\n💰 残り所持金: **${userData.balance} コイン**`)
                .setColor(result.color)
                .setFooter({ text: `ガチャ費用: ${GACHA_COST} コイン` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error(error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply('⚠️ エラーが発生しました。');
        } else {
            await interaction.reply({ content: '⚠️ エラーが発生しました。', ephemeral: true });
        }
    }
});

// Render等ホスティング用の簡易HTTPサーバー
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT, () => {
    console.log(`🌐 HTTP Server is listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
