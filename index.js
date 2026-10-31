const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

// 🤖 Gemini API の初期化
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ----------------------------------------------------
// ⚙️ 設定・定数エリア（ご自身のサーバーのIDに書き換えてください）
// ----------------------------------------------------
const CREATOR_CHANNEL_ID = 'YOUR_CREATOR_VOICE_CHANNEL_ID'; // 部屋作成用VCのID
const CATEGORY_ID = 'YOUR_CATEGORY_ID';                     // 自動生成部屋を置くカテゴリID (不要なら null)
const WELCOME_CHANNEL_ID = 'YOUR_WELCOME_CHANNEL_ID';       // 入室挨拶チャンネルのID
const LOG_CHANNEL_ID = 'YOUR_LOG_CHANNEL_ID';               // 退室ログチャンネルのID

const BASE_COIN_PER_MINUTE = 2; // 通話マイニングの基礎コイン（1分あたり）

// 称号ごとのパッシブボーナス設定
const TITLE_BONUSES = {
    '🎙️ 通話廃人': 3,  // 1分ごとに +3 コイン追加
    '🎰 ガチャ中毒': 1, // 1分ごとに +1 コイン追加
    '💰 大富豪': 5      // 1分ごとに +5 コイン追加
};

// ----------------------------------------------------
// 1. 経済データ（economy.json）管理
// ----------------------------------------------------
const DATA_FILE = path.join(__dirname, 'economy.json');
let economyData = {};

if (fs.existsSync(DATA_FILE)) {
    try {
        economyData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        economyData = {};
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(economyData, null, 2));
}

function getUserData(userId) {
    if (!economyData[userId]) {
        economyData[userId] = {
            balance: 0,
            lastDaily: 0,
            multiplier: 1.0,
            multiplierExpire: 0,
            totalVoiceMinutes: 0,
            totalGachaCount: 0,
            totalSpentCoins: 0,
            badges: ['🔰 新人メンバー'],
            equippedBadge: '🔰 新人メンバー'
        };
    }

    if (economyData[userId].multiplierExpire > 0 && Date.now() > economyData[userId].multiplierExpire) {
        economyData[userId].multiplier = 1.0;
        economyData[userId].multiplierExpire = 0;
    }

    return economyData[userId];
}

// 🏅 バッジ獲得判定
function checkAndAwardBadges(userData) {
    const newBadges = [];
    if (userData.totalVoiceMinutes >= 600 && !userData.badges.includes('🎙️ 通話廃人')) {
        userData.badges.push('🎙️ 通話廃人');
        newBadges.push('🎙️ 通話廃人');
    }
    if (userData.totalGachaCount >= 50 && !userData.badges.includes('🎰 ガチャ中毒')) {
        userData.badges.push('🎰 ガチャ中毒');
        newBadges.push('🎰 ガチャ中毒');
    }
    if (userData.balance >= 10000 && !userData.badges.includes('💰 大富豪')) {
        userData.badges.push('💰 大富豪');
        newBadges.push('💰 大富豪');
    }
    return newBadges;
}

// ----------------------------------------------------
// 2. 一時ボイスチャンネル管理用マップ
// ----------------------------------------------------
const temporaryChannels = new Map();

// ----------------------------------------------------
// 3. Client 初期化 (AIの返答やメッセージ検知に必要な MessageContent を含む)
// ----------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ----------------------------------------------------
// 4. スラッシュコマンド定義
// ----------------------------------------------------
const commands = [
    new SlashCommandBuilder().setName('daily').setDescription('デイリーボーナスを受け取る'),
    new SlashCommandBuilder().setName('balance').setDescription('自分の所持金を確認する'),
    new SlashCommandBuilder().setName('gacha').setDescription('ガチャを回す（1回 100コイン）'),
    new SlashCommandBuilder().setName('menu').setDescription('今日の献立ガチャ'),
    new SlashCommandBuilder().setName('omikuji').setDescription('本日の運勢おみくじ'),
    new SlashCommandBuilder().setName('topic').setDescription('雑談お題ガチャ'),
    new SlashCommandBuilder().setName('ticket').setDescription('お問い合わせチケット作成パネルを設置します（管理者用）'),
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('プロフィールやスタッツ、称号を確認します')
        .addUserOption(opt => opt.setName('user').setDescription('確認したいユーザー')),
    new SlashCommandBuilder()
        .setName('title')
        .setDescription('装着する称号を変更します')
        .addStringOption(opt => opt.setName('name').setDescription('装着したい称号名').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// ----------------------------------------------------
// 5. 起動時処理 ＆ 定期タスク (通話マイニング)
// ----------------------------------------------------
client.once('clientReady', async () => {
    try {
        console.log(`🤖 ログインしました: ${client.user.tag}`);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✨ スラッシュコマンドの登録が完了しました！');

        // 🎙️ 通話マイニング（1分ごとに実行）
        setInterval(async () => {
            try {
                for (const [guildId, guild] of client.guilds.cache) {
                    for (const [channelId, channel] of guild.channels.cache) {
                        if (channel.type === 2) {
                            if (channel.members.size < 2) continue; // 2人以上で有効

                            for (const [memberId, member] of channel.members) {
                                if (member.user.bot) continue;
                                if (member.voice.selfMute || member.voice.selfDeaf) continue;

                                const userData = getUserData(memberId);
                                userData.totalVoiceMinutes += 1;

                                let calculatedCoins = BASE_COIN_PER_MINUTE * userData.multiplier;

                                if (userData.equippedBadge && TITLE_BONUSES[userData.equippedBadge]) {
                                    calculatedCoins += TITLE_BONUSES[userData.equippedBadge];
                                }

                                userData.balance += Math.round(calculatedCoins);
                            }
                        }
                    }
                }
                saveData();
            } catch (err) {
                console.error('通話マイニングエラー:', err.message);
            }
        }, 60 * 1000);

    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

// ----------------------------------------------------
// 6. メンバー入退出ログイベント
// ----------------------------------------------------
client.on('guildMemberAdd', async member => {
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle('🎉 メンバーが参加しました！')
        .setDescription(`${member} さん、サーバーへようこそ！\nルールを確認して楽しんでいってくださいね！`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0x2ECC71)
        .setTimestamp();

    await channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async member => {
    const channel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle('🚪 メンバーが退出しました')
        .setDescription(`**${member.user.tag}** さんがサーバーから退出しました。`)
        .setColor(0xE74C3C)
        .setTimestamp();

    await channel.send({ embeds: [embed] });
});

// ----------------------------------------------------
// 7. ボイスチャンネル自動管理イベント
// ----------------------------------------------------
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    const guild = newState.guild;

    if (newState.channelId === CREATOR_CHANNEL_ID) {
        try {
            const voiceChannel = await guild.channels.create({
                name: `🔊 ${member.displayName}の部屋`,
                type: 2,
                parent: CATEGORY_ID !== 'YOUR_CATEGORY_ID' ? CATEGORY_ID : null,
            });
            await member.voice.setChannel(voiceChannel);
            temporaryChannels.set(voiceChannel.id, true);
        } catch (error) {
            console.error('VC作成エラー:', error);
        }
    }

    if (oldState.channel && oldState.channel.id !== CREATOR_CHANNEL_ID) {
        const leftChannel = oldState.channel;
        if (temporaryChannels.has(leftChannel.id) && leftChannel.members.size === 0) {
            try {
                await leftChannel.delete();
                temporaryChannels.delete(leftChannel.id);
            } catch (error) {
                console.error('VC削除エラー:', error);
            }
        }
    }
});

// ----------------------------------------------------
// 8. プレフィックスコマンド処理 (.kuwakuwa でGemini AIに質問)
// ----------------------------------------------------
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith('.kuwakuwa')) return;

    const args = message.content.slice(9).trim();
    if (!args) {
        return message.reply('⚠️ AIに聞きたい言葉を入力してください。\n使用例: `.kuwakuwa こんにちは`');
    }

    await message.channel.sendTyping();

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: args,
        });

        const replyText = response.text;

        if (replyText.length > 2000) {
            await message.reply(replyText.substring(0, 1997) + '...');
        } else {
            await message.reply(replyText);
        }
    } catch (error) {
        console.error('Gemini APIエラー:', error);
        await message.reply('⚠️ AIとの通信中にエラーが発生しました。');
    }
});

// ----------------------------------------------------
// 9. インタラクション処理（スラッシュコマンド＆ボタン）
// ----------------------------------------------------
client.on('interactionCreate', async interaction => {
    // 🔘 ボタンインタラクション処理
    if (interaction.isButton()) {
        const { guild, user } = interaction;

        if (interaction.customId === 'create_ticket') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${user.username}`,
                    type: 0, // GuildText
                    permissionOverwrites: [
                        { id: guild.id, deny: ['ViewChannel'] },
                        { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
                    ]
                });

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('チケットを閉じる')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

                await ticketChannel.send({
                    content: `👋 ${user} さん、チケットへようこそ！管理人が対応するまでお待ちください。`,
                    components: [closeRow]
                });

                await interaction.editReply({ content: `✅ チケットを作成しました！ 👉 ${ticketChannel}` });
            } catch (err) {
                console.error('チケット作成エラー:', err);
                await interaction.editReply({ content: '⚠️ チケットの作成に失敗しました。権限を確認してください。' });
            }
        }

        else if (interaction.customId === 'close_ticket') {
            await interaction.reply({ content: '🔒 5秒後にこのチャンネルを削除します...' });
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (err) {
                    console.error('チケット削除エラー:', err);
                }
            }, 5000);
        }
        return;
    }

    // 💬 スラッシュコマンド処理
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user } = interaction;
    const userData = getUserData(user.id);

    // 💰 /balance
    if (commandName === 'balance') {
        await interaction.reply({ content: `💰 現在の所持金: **${userData.balance.toLocaleString()}** コイン`, ephemeral: true });
    }

    // 🎁 /daily
    else if (commandName === 'daily') {
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;
        if (now - userData.lastDaily < cooldown) {
            const remaining = Math.ceil((cooldown - (now - userData.lastDaily)) / (1000 * 60 * 60));
            return interaction.reply({ content: `⏳ デイリーボーナスはあと **約 ${remaining} 時間** 後に受け取れます！`, ephemeral: true });
        }
        userData.balance += 300;
        userData.lastDaily = now;
        saveData();
        await interaction.reply({ content: `🎉 デイリーボーナスを受け取りました！ **+300 コイン** (現在所持金: ${userData.balance} コイン)` });
    }

    // 🎰 /gacha
    else if (commandName === 'gacha') {
        const GACHA_COST = 100;
        if (userData.balance < GACHA_COST) {
            return interaction.reply({ content: `⚠️ コインが不足しています。（必要: ${GACHA_COST} コイン / 所持: ${userData.balance} コイン）`, ephemeral: true });
        }

        userData.balance -= GACHA_COST;
        userData.totalGachaCount += 1;
        userData.totalSpentCoins += GACHA_COST;

        const rand = Math.random() * 100;
        let result = {};

        if (rand < 5) {
            const bonus = 500;
            userData.balance += bonus;
            result = { title: '🌈 超激レア (UR)！！', desc: `大当り！ **${bonus} コイン** 獲得！`, color: 0xE91E63 };
        } else if (rand < 15) {
            const hours = 2;
            const duration = hours * 60 * 60 * 1000;
            const now = Date.now();
            if (userData.multiplierExpire > now) {
                userData.multiplierExpire += duration;
            } else {
                userData.multiplier = 1.5;
                userData.multiplierExpire = now + duration;
            }
            const expireTime = Math.floor(userData.multiplierExpire / 1000);
            result = { title: '🌟 激レア (SSR)！【通話ブースト】', desc: `通話マイニングが **1.5倍** にアップ！ (終了: <t:${expireTime}:R>)`, color: 0xF1C40F };
        } else if (rand < 50) {
            const bonus = 150;
            userData.balance += bonus;
            result = { title: '✨ レア (SR)', desc: `元取れ！ **${bonus} コイン** 獲得！`, color: 0x3498DB };
        } else {
            result = { title: '⚪ ノーマル (N)', desc: '残念！ポケットティッシュを獲得しました。', color: 0x95A5A6 };
        }

        saveData();

        const embed = new EmbedBuilder()
            .setTitle(result.title)
            .setDescription(result.desc)
            .setColor(result.color)
            .setFooter({ text: `残高: ${userData.balance.toLocaleString()} コイン` });

        await interaction.reply({ embeds: [embed] });
    }

    // 🎫 /ticket
    else if (commandName === 'ticket') {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ content: '⚠️ このコマンドは管理者のみ実行できます。', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎫 お問い合わせ・サポート')
            .setDescription('下のボタンを押すと、あなた専用のプライベート相談部屋が作成されます。\n管理人へ質問や連絡がある場合はお気軽にどうぞ！')
            .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('チケットを作成する')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📩')
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }

    // 🍱 /menu
    else if (commandName === 'menu') {
        const menus = ['カレーライス🍛', 'ラーメン🍜', '焼肉🍖', '寿司🍣', 'ハンバーグ🍔', 'オムライス🍳', 'うどん🍲', '唐揚げ定食🍗'];
        const picked = menus[Math.floor(Math.random() * menus.length)];
        const embed = new EmbedBuilder().setTitle('🍱 本日の献立ガチャ').setDescription(`今日のおすすめメニューは… **${picked}** です！`).setColor(0xFF7F50);
        await interaction.reply({ embeds: [embed] });
    }

    // 🥠 /omikuji
    else if (commandName === 'omikuji') {
        const results = [
            { luck: '大吉', item: '赤いスニーカー' }, { luck: '中吉', item: '折りたたみ傘' },
            { luck: '小吉', item: 'お気に入りのマグカップ' }, { luck: '吉', item: '文房具' }, { luck: '凶', item: '絆創膏' }
        ];
        const picked = results[Math.floor(Math.random() * results.length)];
        const embed = new EmbedBuilder().setTitle('🥠 本日の運勢おみくじ').addFields({ name: '運勢', value: `**${picked.luck}**`, inline: true }, { name: 'ラッキーアイテム', value: picked.item, inline: true }).setColor(0x9B59B6);
        await interaction.reply({ embeds: [embed] });
    }

    // 🗣️ /topic
    else if (commandName === 'topic') {
        const topics = ['最近観た映画やアニメは？', '子供の頃の将来の夢は？', 'もし100万円が自由に使えたら？', '人生最高の食事は？', '生まれ変わるならどの動物？'];
        const picked = topics[Math.floor(Math.random() * topics.length)];
        const embed = new EmbedBuilder().setTitle('🗣️ 本日の雑談お題ガチャ').setDescription(`> **「${picked}」**`).setColor(0x3498DB);
        await interaction.reply({ embeds: [embed] });
    }

    // 👤 /profile
    else if (commandName === 'profile') {
        const targetUser = options.getUser('user') || user;
        const targetData = getUserData(targetUser.id);
        const newBadges = checkAndAwardBadges(targetData);
        saveData();

        const now = Date.now();
        let buffStatus = 'なし（通常時）';
        let color = 0x00AAFF;

        if (targetData.multiplier > 1.0 && targetData.multiplierExpire > now) {
            const expireTime = Math.floor(targetData.multiplierExpire / 1000);
            buffStatus = `🌟 **${targetData.multiplier}倍** ブースト中！ (終了: <t:${expireTime}:R>)`;
            color = 0xF1C40F;
        }

        const hours = Math.floor(targetData.totalVoiceMinutes / 60);
        const minutes = targetData.totalVoiceMinutes % 60;
        const voiceTimeText = hours > 0 ? `${hours}時間 ${minutes}分` : `${minutes}分`;

        const currentBadge = targetData.equippedBadge || '未設定';
        let badgeBonusText = 'なし';
        if (targetData.equippedBadge && TITLE_BONUSES[targetData.equippedBadge]) {
            badgeBonusText = `✨ 効果発動中！ (1分ごとに +${TITLE_BONUSES[targetData.equippedBadge]} コイン)`;
        }

        const badgeList = targetData.badges.length > 0 ? targetData.badges.join(' | ') : 'なし';

        const embed = new EmbedBuilder()
            .setTitle(`👤 ${targetUser.username} さんのプロフィール`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setColor(color)
            .addFields(
                { name: '🏷️ 装着中の称号', value: `**[ ${currentBadge} ]**\n└ 効果: ${badgeBonusText}`, inline: false },
                { name: '💰 所持コイン', value: `**${targetData.balance.toLocaleString()}** コイン`, inline: true },
                { name: '🎙️ 通話倍率', value: buffStatus, inline: true },
                { name: '📊 アクティビティ実績', value: `• 通話時間: **${voiceTimeText}**\n• ガチャ回数: **${targetData.totalGachaCount.toLocaleString()}** 回\n• 総消費コイン: **${targetData.totalSpentCoins.toLocaleString()}** コイン`, inline: false },
                { name: '🏅 所持バッジ一覧', value: badgeList, inline: false }
            )
            .setTimestamp();

        let replyContent = newBadges.length > 0 ? `🎉 **新称号獲得！** ${newBadges.map(b => `[${b}]`).join(' ')} を獲得しました！` : null;
        await interaction.reply({ content: replyContent, embeds: [embed] });
    }

    // 🏷️ /title
    else if (commandName === 'title') {
        const selectedTitle = options.getString('name');
        if (!userData.badges.includes(selectedTitle)) {
            return interaction.reply({ content: `⚠️ 称号「${selectedTitle}」を所持していません。`, ephemeral: true });
        }
        userData.equippedBadge = selectedTitle;
        saveData();
        await interaction.reply({ content: `✨ 装着中の称号を **[ ${selectedTitle} ]** に変更しました！`, ephemeral: true });
    }
});

// ----------------------------------------------------
// 10. Render対策 HTTPサーバー起動 ＆ ログイン
// ----------------------------------------------------
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running!\n');
}).listen(PORT);

client.login(process.env.DISCORD_TOKEN);
