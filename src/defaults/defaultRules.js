/**
 * Fetches the default rules from default-rules.txt at runtime.
 * This allows users to edit the text file directly without modifying JS code.
 * @returns {Promise<string>} The default rules text.
 */
export async function getDefaultRules() {
    try {
        const response = await fetch('./default-rules.txt');
        if (!response.ok) {
            throw new Error(`Failed to load default-rules.txt: ${response.statusText}`);
        }
        return await response.text();
    } catch (error) {
        console.error('Error loading default rules:', error);
        return '（デフォルトルールの読み込みに失敗しました。Formatting Rulesファイルをアップロードしてください。）';
    }
}
