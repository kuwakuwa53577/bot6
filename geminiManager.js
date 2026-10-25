// 標準の fetch を使った Gemini API 呼び出しマネージャー（追加パッケージ不要！）
async function callGemini(prompt, modelName = 'gemini-1.5-flash') {
    // 複数キーのローテーションにも対応できるようにカンマ区切りをサポート
    const keysEnv = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    const apiKeys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);

    if (apiKeys.length === 0) {
        throw new Error('GEMINI_API_KEY が設定されていません。');
    }

    // とりあえず最初のキーを使用（必要ならローテーションも可能）
    const apiKey = apiKeys[0];

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || `Gemini APIエラー (Status: ${response.status})`);
    }

    try {
        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        throw new Error('Geminiからのレスポンス解析に失敗しました。');
    }
}

module.exports = { callGemini };
