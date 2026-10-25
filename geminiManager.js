const { GoogleGenAI } = require('@google/genai'); // または fetch を使う簡易版でもOKですが、公式SDKやfetchで安全に呼び出します

// 簡易的にGoogle Gemini APIを呼び出す関数
async function callGemini(prompt, modelName = 'gemini-1.5-flash') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY が設定されていません。');

    // Google公式の仕様または標準fetchで呼び出し
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || 'Gemini API呼び出しエラー');
    }

    return data.candidates[0].content.parts[0].text;
}

module.exports = { callGemini };
