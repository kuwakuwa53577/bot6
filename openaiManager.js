const OpenAI = require('openai');

class OpenAIManager {
    constructor() {
        const keysEnv = process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY || '';
        this.apiKeys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
        
        if (this.apiKeys.length === 0) {
            console.warn('⚠️ OpenAIのAPIキーが設定されていません。');
        }
        
        this.currentIndex = 0;
    }

    getClient() {
        if (this.apiKeys.length === 0) throw new Error('利用可能なAPIキーがありません。');
        return new OpenAI({ apiKey: this.apiKeys[this.currentIndex] });
    }

    rotateKey() {
        if (this.apiKeys.length <= 1) return false;
        
        const prevIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        console.warn(`🔄 OpenAI APIキーをローテーションしました [Index: ${prevIndex} -> ${this.currentIndex}]`);
        return true;
    }

    async safeRequest(apiCallFn) {
        let attempts = 0;
        const maxAttempts = this.apiKeys.length;

        while (attempts < maxAttempts) {
            try {
                const openai = this.getClient();
                return await apiCallFn(openai);
            } catch (error) {
                console.error(`❌ APIキー [Index: ${this.currentIndex}] でエラー発生:`, error.message);
                
                const status = error.status;
                const code = error.code;
                
                // 429、クォータ不足、残高切れ、認証エラーなどの場合は次のキーに切り替え
                if (
                    status === 429 || 
                    status === 402 || 
                    status === 401 || 
                    status === 503 ||
                    code === 'credit_balance_exhausted' ||
                    code === 'insufficient_quota' ||
                    error.message.includes('credits remaining') ||
                    error.message.includes('quota')
                ) {
                    const rotated = this.rotateKey();
                    if (!rotated) throw error;
                } else {
                    throw error;
                }
            }
            attempts++;
        }
        throw new Error('すべてのOpenAI APIキーが制限に達するか、エラーが発生しました。');
    }
}

module.exports = new OpenAIManager();
