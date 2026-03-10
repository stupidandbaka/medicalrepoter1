import { extractTextFromFile } from '../parsers/fileParser.js';
import { pdfToImages } from '../parsers/pdfToImages.js';
import { getDefaultRules } from '../defaults/defaultRules.js';

/**
 * Helper to convert file to base64
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Check if the file is a PDF
 */
function isPdf(file) {
    return file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
}

/**
 * Check if the file is an image
 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.tiff', '.tif'];
function isImage(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get the MIME type for a file (for Gemini inlineData)
 */
function getFileMimeType(file) {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeMap = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
        'heic': 'image/heic', 'heif': 'image/heif', 'tiff': 'image/tiff', 'tif': 'image/tiff',
        'pdf': 'application/pdf'
    };
    return mimeMap[ext] || 'application/octet-stream';
}

// Disease information categories for the gather step
const DISEASE_INFO_CATEGORIES = `以下の項目を中心に、箇条書きで分かりやすく整理してください：
- 疾患名（主疾患・合併症）
- 疾患の定義・概要
- 疫学（発生頻度、好発年齢・性差など）
- 病態生理・原因
- 主な症状・臨床所見
- 診断基準・検査所見
- 標準的な治療法
- 予後・転帰`;

/**
 * Base AI Client class
 */
class AIClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    buildReportPrompt(gatheredInfo, ruleText, targetLength, targetLanguage, hasPastReports) {
        let styleInstruction = "";
        if (hasPastReports) {
            styleInstruction = "\n【重要：表記の個性反映】\n提供された【完成されたレポート（過去レポート）】を分析し、その文体、フォーマット、特徴的な表現（表記の個性）を抽出し、出力する最終レポートに可能な限り反映させてください。";
        }

        return `あなたはプロフェッショナルな医療レポート作成の専門家です。
以下の手順でレポートを作成してください：

**ステップA：** 【確認済み疾患情報】を基に、レポートに必要な医学的知識を把握してください。
**ステップB：** 【症例データ】から、レポート作成に必要な臨床データ（患者情報、検査値、経過、治療内容など）をすべて抽出してください。
**ステップC：** 抽出した臨床データと疾患情報を組み合わせて、【ルール要件】のフォーマットに従い、${targetLength}文字程度の「症例要約レポート」を完成させてください。${styleInstruction}

出力言語は必ず【${targetLanguage}】で作成してください。

【重要】
最終的なレポートを出力する前に、医学論文としての表現やトーン、専門用語の正確さなど、プロフェッショナルな品質が保たれているか内部で確認・推敲し、最高品質のレポートのみを最終出力として提示してください。
症例データから臨床情報を過不足なく抽出し、フォーマット通りに出力してください。

【出力形式の注意】
Markdown記法（#, **, *, \`\`\`, - など）は一切使用しないでください。
        見出しや強調は、「■」「●」「▶」や【】などの記号を使い、プレーンテキストとして読みやすい形式で出力してください。

【ルール要件】
${ruleText}

【確認済み疾患情報】
${gatheredInfo} `;
    }

    async gatherInformation(medicalFile, mainDisease = "", referenceFile = null) {
        throw new Error("Method 'gatherInformation()' must be implemented.");
    }

    async generateFinalReport(gatheredInfo, ruleFile, medicalFile, referenceFile, pastReports = [], targetLength = 1400, targetLanguage = 'Japanese') {
        throw new Error("Method 'generateFinalReport()' must be implemented.");
    }

    async differentialDiagnosis(medicalFile, referenceFile = null) {
        throw new Error("Method 'differentialDiagnosis()' must be implemented.");
    }
}

// ============================================================
// Gemini - uses inlineData for PDFs directly
// ============================================================
export class GeminiClient extends AIClient {
    constructor(apiKey, modelName = 'gemini-2.5-flash') {
        super(apiKey);
        this.modelName = modelName;
    }

    async _callGeminiWithParts(parts) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { temperature: 0.2 }
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Gemini API Error: ${err.error?.message || response.statusText}`);
        }
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }

    /**
     * Step 1: Gather disease information.
     *
     * Flow:
     *   1. If user specified a disease name → use it directly.
     *      If not → AI reads the case file ONLY to extract the disease name.
     *   2. Using that disease name, gather disease knowledge from:
     *      - User-uploaded reference materials (if any)
     *      - Internet / web sources
     *   3. Output structured disease information for user review.
     */
    async gatherInformation(medicalFile, mainDisease = "", referenceFile = null) {
        const parts = [];

        // Determine the disease identification instruction
        let diseaseSource;
        if (mainDisease && mainDisease.trim() !== "") {
            // User specified the disease — no need to read the case file for disease name
            diseaseSource = `ユーザーが指定した主疾患名は「${mainDisease.trim()}」です。この疾患について情報を収集してください。`;
        } else {
            // AI needs to read the case file ONLY to identify the disease name
            if (isPdf(medicalFile) || isImage(medicalFile)) {
                const base64 = await fileToBase64(medicalFile);
                const mimeType = getFileMimeType(medicalFile);
                parts.push({ inlineData: { data: base64, mimeType } });
                parts.push({ text: "\n上記は症例資料のファイルです。\n" });
            } else {
                const medicalText = await extractTextFromFile(medicalFile);
                parts.push({ text: `【症例資料】\n${medicalText}\n` });
            }
            diseaseSource = "上記の症例資料から主疾患名のみを特定し、その疾患について情報を収集してください。症例資料からは疾患名の特定のみに使用し、疾患の情報は参考資料やインターネット情報から収集してください。";
        }

        // Add reference materials if uploaded
        if (referenceFile && referenceFile.length > 0) {
            for (let i = 0; i < referenceFile.length; i++) {
                const refFile = referenceFile[i];
                if (isPdf(refFile) || isImage(refFile)) {
                    const base64 = await fileToBase64(refFile);
                    const mimeType = getFileMimeType(refFile);
                    parts.push({ inlineData: { data: base64, mimeType } });
                    parts.push({ text: `\n上記は【参考資料 その${i + 1}】のファイルです。疾患の情報収集に活用してください。\n` });
                } else {
                    const referenceText = await extractTextFromFile(refFile);
                    parts.push({ text: `【参考資料 その${i + 1}】\n${referenceText}\n` });
                }
            }
        }

        // Build the information gathering instruction
        let infoSourceInstruction;
        if (referenceFile && referenceFile.length > 0) {
            infoSourceInstruction = "【参考資料】の内容と、インターネット検索等で公的な機関など信頼度の高いサイトから得た情報を統合して、医学的に正しい事実に基づいて疾患情報を整理してください。";
        } else {
            infoSourceInstruction = "インターネット検索等を用いて公的な機関など信頼度の高いサイトの情報を調べ、医学的に正しい事実に基づいて疾患情報を整理してください。";
        }

        parts.push({
            text: `あなたはプロの医療アシスタントです。ここではまだレポートを作成せず、疾患に関する情報のまとめのみを出力してください。
ユーザーが内容を確認・修正した上で、次のステップでレポートを作成します。

${diseaseSource}

${infoSourceInstruction}

${DISEASE_INFO_CATEGORIES}

【出力形式の注意】
Markdown記法（#, **, *, \`\`\`, - など）は一切使用しないでください。
            見出しや強調は、「■」「●」「▶」や【】などの記号を使い、箇条書きは「・」を使用して、プレーンテキストとして読みやすい形式で出力してください。`
        });

        return await this._callGeminiWithParts(parts);
    }

    /**
     * Step 2: Generate final report.
     *
     * Flow:
     *   1. Re-read the original case files to extract clinical data.
     *   2. Combine with confirmed disease info from Step 1.
     *   3. Apply formatting rules to generate the final report.
     */
    async generateFinalReport(gatheredInfo, ruleFile, medicalFile, referenceFile, pastReports = [], targetLength = 1400, targetLanguage = 'Japanese') {
        const parts = [];

        // 1. Add original case files so AI can extract clinical data
        if (medicalFile) {
            if (isPdf(medicalFile) || isImage(medicalFile)) {
                const base64 = await fileToBase64(medicalFile);
                const mimeType = getFileMimeType(medicalFile);
                parts.push({ inlineData: { data: base64, mimeType } });
                parts.push({ text: "\n上記は【症例データ】のファイルです。臨床データを抽出してください。\n" });
            } else {
                const medicalText = await extractTextFromFile(medicalFile);
                parts.push({ text: `【症例データ】\n${medicalText}\n` });
            }
        }

        // 2. Add reference material if available
        if (referenceFile && referenceFile.length > 0) {
            for (let i = 0; i < referenceFile.length; i++) {
                const refFile = referenceFile[i];
                if (isPdf(refFile) || isImage(refFile)) {
                    const base64 = await fileToBase64(refFile);
                    const mimeType = getFileMimeType(refFile);
                    parts.push({ inlineData: { data: base64, mimeType } });
                    parts.push({ text: `\n上記は【参考資料 その${i + 1}】のファイルです。\n` });
                } else {
                    const referenceText = await extractTextFromFile(refFile);
                    parts.push({ text: `【参考資料 その${i + 1}】\n${referenceText}\n` });
                }
            }
        }

        // 3. Add past reports if available
        if (pastReports && pastReports.length > 0) {
            for (let i = 0; i < pastReports.length; i++) {
                const prFile = pastReports[i];
                if (isPdf(prFile) || isImage(prFile)) {
                    const base64 = await fileToBase64(prFile);
                    const mimeType = getFileMimeType(prFile);
                    parts.push({ inlineData: { data: base64, mimeType } });
                    parts.push({ text: `\n上記は【完成されたレポート（過去レポート）その${i + 1}】のファイルです。\n` });
                } else {
                    const prText = await extractTextFromFile(prFile);
                    parts.push({ text: `【完成されたレポート（過去レポート）その${i + 1}】\n${prText} \n` });
                }
            }
            parts.push({ text: "\n上記の過去レポートの文体や表記の特徴（表記の個性）を詳細に分析し、直後に出力するレポートにその表記の個性を強く反映させてください。\n" });
        }

        // 4. Add the report generation prompt with confirmed disease info and rules
        let ruleText;
        if (ruleFile) {
            ruleText = await extractTextFromFile(ruleFile);
        } else {
            ruleText = await getDefaultRules();
        }
        const hasPastReports = pastReports && pastReports.length > 0;
        const prompt = this.buildReportPrompt(gatheredInfo, ruleText, targetLength, targetLanguage, hasPastReports);
        parts.push({ text: prompt });

        return await this._callGeminiWithParts(parts);
    }

    /**
     * Differential Diagnosis Mode:
     * Analyzes uploaded case information and produces a comprehensive
     * differential diagnosis list ordered by probability.
     */
    async differentialDiagnosis(medicalFile, referenceFile = null) {
        const parts = [];

        // Add the medical record file
        if (isPdf(medicalFile) || isImage(medicalFile)) {
            const base64 = await fileToBase64(medicalFile);
            const mimeType = getFileMimeType(medicalFile);
            parts.push({ inlineData: { data: base64, mimeType } });
            parts.push({ text: "\n上記は症例資料のファイルです。\n" });
        } else {
            const medicalText = await extractTextFromFile(medicalFile);
            parts.push({ text: `【症例資料】\n${medicalText} \n` });
        }

        // Add reference materials if uploaded
        if (referenceFile && referenceFile.length > 0) {
            for (let i = 0; i < referenceFile.length; i++) {
                const refFile = referenceFile[i];
                if (isPdf(refFile) || isImage(refFile)) {
                    const base64 = await fileToBase64(refFile);
                    const mimeType = getFileMimeType(refFile);
                    parts.push({ inlineData: { data: base64, mimeType } });
                    parts.push({ text: `\n上記は【参考資料 その${i + 1}】のファイルです。鑑別診断の参考にしてください。\n` });
                } else {
                    const referenceText = await extractTextFromFile(refFile);
                    parts.push({ text: `【参考資料 その${i + 1}】\n${referenceText} \n` });
                }
            }
        }

        // Build the differential diagnosis prompt
        parts.push({
            text: `あなたは経験豊富な臨床医であり、鑑別診断の専門家です。
上記の症例資料を注意深く分析し、以下のステップに従って鑑別診断を行ってください。

━━━━━━━━━━━━━━━━━━━
【ステップ①】症例情報の抽出
━━━━━━━━━━━━━━━━━━━
アップロードされた症例資料から以下の情報を正確に読み取り、整理してください：
・年齢
・性別
・主訴
・現病歴（経過）
・既往歴・家族歴
・バイタルサイン
・身体所見
・検査所見（血液検査、画像検査、その他）

━━━━━━━━━━━━━━━━━━━
【ステップ②】異常所見の特定
━━━━━━━━━━━━━━━━━━━
ステップ①で得られた情報から、正常範囲を逸脱している異常所見をすべて列挙してください。
各所見について、なぜ異常と判断したかの根拠を簡潔に記載してください。

━━━━━━━━━━━━━━━━━━━
【ステップ③】鑑別疾患の列挙
━━━━━━━━━━━━━━━━━━━
以下の観点を参考に、考えうる鑑別疾患をできるだけ多く列挙してください：
・好発年齢・性別との一致
・特有の臨床経過パターン
・異常所見との関連性
・疫学的頻度

━━━━━━━━━━━━━━━━━━━
【ステップ④】各鑑別疾患の評価
━━━━━━━━━━━━━━━━━━━
列挙した各鑑別疾患について、以下を記載してください：
・✅ 合致する所見: 本症例と一致する臨床所見・検査結果
・❌ 合致しない所見: 本症例と矛盾する点、または典型的でない点
・🔍 追加すべき検査: 本疾患を確定・除外するために必要な追加検査項目

━━━━━━━━━━━━━━━━━━━
【ステップ⑤】総合評価（確率順）
━━━━━━━━━━━━━━━━━━━
上記の分析を総合し、可能性が高い疾患から順に並べ替えて最終的な鑑別診断リストを出力してください。
各疾患には推定確率（高・中・低）を付記し、その根拠を簡潔に記載してください。

【出力形式】
上記ステップ①〜⑤の結果を、見出し付きで分かりやすく構造化して出力してください。
Markdown記法（#, **, *, \`\`\`, - など）は一切使用しないでください。
見出しは「■」「●」「▶」や【】、━━━ などの記号を使い、箇条書きは「・」を使用して、プレーンテキストとして読みやすい形式で出力してください。`
        });

        return await this._callGeminiWithParts(parts);
    }
}

// ============================================================
// Factory - All models are Gemini variants
// ============================================================
export function getAIClient(modelType, apiKey) {
    return new GeminiClient(apiKey, modelType);
}
