import { extractTextFromFile } from './parsers/fileParser.js';
import { getAIClient } from './api/llmClient.js';

// DOM Elements
const medicalRecordArea = document.getElementById('medical-record-area');
const ruleFileArea = document.getElementById('rule-file-area');
const referenceMaterialArea = document.getElementById('reference-material-area');
const pastReportsArea = document.getElementById('past-reports-area');
const medicalRecordPreview = document.getElementById('medical-record-preview');
const ruleFilePreview = document.getElementById('rule-file-preview');
const referenceMaterialPreview = document.getElementById('reference-material-preview');
const pastReportsPreview = document.getElementById('past-reports-preview');
const actionBtn = document.getElementById('action-btn');
const copyBtn = document.getElementById('copy-btn');
const outputText = document.getElementById('output-text');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const aiModelSelect = document.getElementById('ai-model');
const apiKeyLink = document.getElementById('api-key-link');
const downloadBar = document.getElementById('download-bar');
const dlTxtBtn = document.getElementById('dl-txt');
const dlDocBtn = document.getElementById('dl-doc');

// DOM Elements (Inputs)
const medicalRecordInput = document.getElementById('medical-record');
const ruleFileInput = document.getElementById('rule-file');
const referenceMaterialInput = document.getElementById('reference-material');
const pastReportsInput = document.getElementById('past-reports');

// API Key link (always Gemini)
const GEMINI_KEY_URL = 'https://aistudio.google.com/app/apikey';
const GEMINI_KEY_TEXT = 'Get Gemini API Key ↗';

// State
let files = {
    medicalRecord: null,
    ruleFile: null,
    referenceMaterial: [],
    pastReports: []
};

let currentStep = 'gather'; // 'gather' | 'generate' | 'done'
let isDifferentialMode = false;

// --- Initialization ---
function init() {
    setupDragAndDrop(medicalRecordArea, medicalRecordInput, 'medicalRecord');
    setupDragAndDrop(ruleFileArea, ruleFileInput, 'ruleFile');
    setupDragAndDrop(referenceMaterialArea, referenceMaterialInput, 'referenceMaterial');
    setupDragAndDrop(pastReportsArea, pastReportsInput, 'pastReports');

    actionBtn.addEventListener('click', handleAction);
    copyBtn.addEventListener('click', copyToClipboard);
    dlTxtBtn.addEventListener('click', () => downloadAs('txt'));
    dlDocBtn.addEventListener('click', () => downloadAs('doc'));

    // Set Gemini API key link
    apiKeyLink.href = GEMINI_KEY_URL;
    apiKeyLink.textContent = GEMINI_KEY_TEXT;

    // Differential mode detection
    const mainDiseaseInput = document.getElementById('main-disease');
    mainDiseaseInput.addEventListener('input', () => {
        const val = mainDiseaseInput.value.trim();
        if (val === '？' || val === '?') {
            if (!isDifferentialMode) activateDifferentialMode();
        } else {
            if (isDifferentialMode) deactivateDifferentialMode();
        }
    });
}

// --- Differential Mode ---
function activateDifferentialMode() {
    isDifferentialMode = true;
    document.body.classList.add('differential-mode');
    document.getElementById('differential-mode-banner').style.display = 'flex';
    actionBtn.innerHTML = `<span class="btn-text">🔬 鑑別診断を実行</span><span class="icon right-icon">⚕️</span>`;
    document.getElementById('step-instruction').textContent = '症例資料をアップロードし、AIが鑑別疾患を列挙・評価します。';
    // Reset step state for differential mode
    currentStep = 'gather';
    outputText.value = '';
    outputText.readOnly = true;
    copyBtn.disabled = true;
    downloadBar.style.display = 'none';
    document.getElementById('output-title').textContent = 'Output Area';
    document.getElementById('output-icon').textContent = '📄';
}

function deactivateDifferentialMode() {
    isDifferentialMode = false;
    document.body.classList.remove('differential-mode');
    document.getElementById('differential-mode-banner').style.display = 'none';
    resetState();
}

// --- Event Handlers & UI Logic ---
function setupDragAndDrop(dropArea, inputElement, stateKey) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
    });

    dropArea.addEventListener('drop', (e) => {
        handleFiles(e.dataTransfer.files, stateKey);
    }, false);

    // The file input already overlays the drop area (opacity:0, position:absolute)
    // so we do NOT add a separate click handler on dropArea, as it causes
    // double-trigger issues on Android devices.
    if (stateKey !== 'pastReports' && stateKey !== 'referenceMaterial') {
        dropArea.addEventListener('click', () => inputElement.click());
    }

    // Stop click from bubbling to avoid conflicts
    inputElement.addEventListener('click', (e) => e.stopPropagation());

    inputElement.addEventListener('change', function () {
        if (this.files && this.files.length > 0) {
            handleFiles(this.files, stateKey);
        }
    });
}

function handleFiles(selectedFiles, stateKey) {
    if (selectedFiles && selectedFiles.length > 0) {
        if (stateKey === 'pastReports' || stateKey === 'referenceMaterial') {
            files[stateKey].push(...Array.from(selectedFiles));
        } else {
            files[stateKey] = selectedFiles[0];
        }
        updateFilePreview(stateKey);
    }
}

function updateFilePreview(stateKey) {
    if (stateKey === 'pastReports' || stateKey === 'referenceMaterial') {
        const fileList = files[stateKey];
        const areaId = stateKey === 'pastReports' ? 'past-reports-area' : 'reference-material-area';
        const previewId = stateKey === 'pastReports' ? 'past-reports-preview' : 'reference-material-preview';
        const inputElement = stateKey === 'pastReports' ? pastReportsInput : referenceMaterialInput;

        const areaElement = document.getElementById(areaId);
        const previewElement = document.getElementById(previewId);

        if (!fileList || fileList.length === 0) {
            areaElement.style.display = 'flex';
            previewElement.style.display = 'none';
            inputElement.value = '';
            return;
        }

        areaElement.style.display = 'none';
        previewElement.style.display = 'flex';

        previewElement.innerHTML = '';
        fileList.forEach((file, index) => {
            const fileSizeStr = (file.size / 1024 / 1024).toFixed(2);
            const itemDiv = document.createElement('div');
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';
            itemDiv.style.justifyContent = 'space-between';
            itemDiv.style.gap = '0.5rem';
            itemDiv.style.width = '100%';
            itemDiv.style.padding = '4px 8px';
            itemDiv.style.background = 'var(--bg-secondary)';
            itemDiv.style.borderRadius = 'var(--border-radius)';

            itemDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden; flex: 1;">
                    <span class="icon" style="flex-shrink: 0;">📄</span>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.name}</span>
                    <span style="color: var(--text-secondary); font-size: 0.8rem; flex-shrink: 0;">(${fileSizeStr} MB)</span>
                </div>
                <button class="remove-file-btn" data-index="${index}" style="background:none; border:none; color:var(--error-color); cursor:pointer; font-size: 1.2rem;">&times;</button>
            `;

            itemDiv.querySelector('.remove-file-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                files[stateKey].splice(index, 1);
                updateFilePreview(stateKey);
            });
            previewElement.appendChild(itemDiv);
        });

        const addMoreDiv = document.createElement('div');
        addMoreDiv.style.marginTop = '0.5rem';
        addMoreDiv.style.fontSize = '0.85rem';
        addMoreDiv.style.color = 'var(--accent-blue)';
        addMoreDiv.style.cursor = 'pointer';
        addMoreDiv.style.textAlign = 'center';
        addMoreDiv.textContent = '+ Add more files';
        addMoreDiv.addEventListener('click', () => inputElement.click());
        previewElement.appendChild(addMoreDiv);

        return;
    }

    const file = files[stateKey];
    if (!file) return;

    const areaElement = document.getElementById(`${stateKey.replace(/([A-Z])/g, '-$1').toLowerCase()}-area`);
    const previewElement = document.getElementById(`${stateKey.replace(/([A-Z])/g, '-$1').toLowerCase()}-preview`);

    areaElement.style.display = 'none';
    previewElement.style.display = 'flex';

    const fileSizeStr = (file.size / 1024 / 1024).toFixed(2); // MB
    previewElement.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden;">
            <span class="icon" style="flex-shrink: 0;">📄</span>
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${file.name}</span>
            <span style="color: var(--text-secondary); font-size: 0.8rem; flex-shrink: 0;">(${fileSizeStr} MB)</span>
        </div>
        <button class="remove-file-btn" data-key="${stateKey}" style="background:none; border:none; color:var(--error-color); cursor:pointer; font-size: 1.2rem;">&times;</button>
    `;

    previewElement.querySelector('.remove-file-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        files[stateKey] = null;
        areaElement.style.display = 'flex';
        previewElement.style.display = 'none';

        if (stateKey === 'medicalRecord') medicalRecordInput.value = '';
        if (stateKey === 'ruleFile') ruleFileInput.value = '';
    });
}

async function copyToClipboard() {
    try {
        await navigator.clipboard.writeText(outputText.value);
        copyBtn.innerHTML = '✅ Copied!';
        setTimeout(() => {
            copyBtn.innerHTML = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
        }, 2000);
    } catch (err) {
        alert('Failed to copy to clipboard.');
    }
}

function setLoading(isLoading, message = 'Processing...') {
    if (isLoading) {
        loadingOverlay.style.display = 'flex';
        loadingText.textContent = message;
        actionBtn.disabled = true;
    } else {
        loadingOverlay.style.display = 'none';
        actionBtn.disabled = false;
    }
}

function showError(message) {
    alert(`Error: ${message}`);
    setLoading(false);
}

// --- Differential Diagnosis Action ---
async function handleDifferentialAction() {
    if (currentStep === 'done') {
        // Reset for another differential run
        currentStep = 'gather';
        outputText.value = '';
        outputText.readOnly = true;
        copyBtn.disabled = true;
        downloadBar.style.display = 'none';
        actionBtn.innerHTML = `<span class="btn-text">🔬 鑑別診断を実行</span><span class="icon right-icon">⚕️</span>`;
        document.getElementById('step-instruction').textContent = '症例資料をアップロードし、AIが鑑別疾患を列挙・評価します。';
        document.getElementById('output-title').textContent = 'Output Area';
        document.getElementById('output-icon').textContent = '📄';
        return;
    }

    const apiKey = document.getElementById('api-key').value.trim();
    const modelType = document.getElementById('ai-model').value;

    if (!apiKey) return showError('Please enter an API Key.');
    if (!files.medicalRecord) return showError('Please upload a Medical Record file.');

    const aiClient = getAIClient(modelType, apiKey);

    try {
        setLoading(true, `🔬 鑑別診断を実行中... (${modelType.toUpperCase()})`);
        const result = await aiClient.differentialDiagnosis(files.medicalRecord, files.referenceMaterial);

        outputText.value = result;
        outputText.readOnly = true;
        copyBtn.disabled = false;
        downloadBar.style.display = 'flex';

        currentStep = 'done';
        actionBtn.innerHTML = `<span class="btn-text">リセット / もう一度</span><span class="icon right-icon">🔄</span>`;
        document.getElementById('step-instruction').textContent = '鑑別診断が完了しました。コピー、ダウンロード、またはやり直しが可能です。';
        document.getElementById('output-title').textContent = '🔬 鑑別診断結果';
        document.getElementById('output-icon').textContent = '⚕️';

    } catch (error) {
        console.error('Differential Diagnosis Error:', error);
        showError(error.message || '鑑別診断中にエラーが発生しました。');
    } finally {
        setLoading(false);
    }
}

// --- Main Generation Flow ---
async function handleAction() {
    // Differential mode branch
    if (isDifferentialMode) {
        return handleDifferentialAction();
    }

    if (currentStep === 'done') {
        currentStep = 'gather';
        outputText.value = '';
        outputText.readOnly = true;
        actionBtn.innerHTML = `<span class="btn-text">1. Analyze & Gather Info</span><span class="icon right-icon">🔍</span>`;
        document.getElementById('step-instruction').textContent = "First, the AI will gather and integrate information for your review.";
        document.getElementById('output-title').textContent = "Output Area";
        document.getElementById('output-icon').textContent = "📄";
        copyBtn.disabled = true;
        return;
    }

    const apiKey = document.getElementById('api-key').value.trim();
    const modelType = document.getElementById('ai-model').value;
    const mainDisease = document.getElementById('main-disease').value.trim();
    const targetLengthInput = document.getElementById('target-length').value.trim();
    const targetLength = targetLengthInput ? parseInt(targetLengthInput, 10) : 1400;
    const targetLanguage = document.getElementById('target-language').value;

    if (!apiKey) return showError('Please enter an API Key.');

    const aiClient = getAIClient(modelType, apiKey);

    if (currentStep === 'gather') {
        if (!files.medicalRecord) return showError('Please upload a Medical Record file.');

        try {
            setLoading(true, `Gathering information using ${modelType.toUpperCase()}...`);
            const gatheredInfo = await aiClient.gatherInformation(files.medicalRecord, mainDisease, files.referenceMaterial);

            outputText.value = gatheredInfo;
            outputText.readOnly = false; // Allow user editing

            // Advance state
            currentStep = 'generate';
            actionBtn.innerHTML = `<span class="btn-text">2. Approve & Generate Report</span><span class="icon right-icon">✨</span>`;
            document.getElementById('step-instruction').textContent = "Review and edit the correct information above, then proceed to generate the final report.";
            document.getElementById('output-title').textContent = "Review Gathered Information (Editable)";
            document.getElementById('output-icon').textContent = "✏️";

        } catch (error) {
            console.error("Gather Error:", error);
            showError(error.message || 'An unexpected error occurred during gathering.');
        } finally {
            setLoading(false);
        }

    } else if (currentStep === 'generate') {

        const gatheredInfo = outputText.value;
        if (!gatheredInfo.trim()) return showError('Gathered information cannot be empty.');

        try {
            setLoading(true, `Generating report using ${modelType.toUpperCase()}...`);
            const finalReport = await aiClient.generateFinalReport(gatheredInfo, files.ruleFile, files.medicalRecord, files.referenceMaterial, files.pastReports, targetLength, targetLanguage);

            outputText.value = finalReport;
            outputText.readOnly = true;
            copyBtn.disabled = false;
            downloadBar.style.display = 'flex';

            // Advance state
            currentStep = 'done';
            actionBtn.innerHTML = `<span class="btn-text">Reset / Start Over</span><span class="icon right-icon">🔄</span>`;
            document.getElementById('step-instruction').textContent = "Report generation complete. You can now copy, download, or start over.";
            document.getElementById('output-title').textContent = "Generated Final Report";
            document.getElementById('output-icon').textContent = "✅";

        } catch (error) {
            console.error("Generation Error:", error);
            showError(error.message || 'An unexpected error occurred during report generation.');
        } finally {
            setLoading(false);
        }
    }
}

// --- Download Functions ---
function downloadAs(format) {
    const text = outputText.value;
    if (!text.trim()) return;

    const BOM = '\uFEFF'; // UTF-8 BOM for Windows compatibility
    const timestamp = new Date().toISOString().slice(0, 10);
    let blob, filename;

    if (format === 'txt') {
        blob = new Blob([BOM + text], { type: 'text/plain;charset=utf-8' });
        filename = `report_${timestamp}.txt`;
    } else if (format === 'doc') {
        // Word-compatible HTML format
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Medical Report</title>
<style>body { font-family: 'Yu Mincho', 'MS Mincho', serif; font-size: 10.5pt; line-height: 1.6; }</style>
</head><body>${text.replace(/\n/g, '<br>')}</body></html>`;
        blob = new Blob([BOM + html], { type: 'application/msword;charset=utf-8' });
        filename = `report_${timestamp}.doc`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Reset Helper ---
function resetState() {
    currentStep = 'gather';
    outputText.value = '';
    outputText.readOnly = true;
    copyBtn.disabled = true;
    downloadBar.style.display = 'none';
    actionBtn.innerHTML = `<span class="btn-text">1. Analyze & Gather Info</span><span class="icon right-icon">🔍</span>`;
    document.getElementById('step-instruction').textContent = "First, the AI will gather and integrate information for your review.";
    document.getElementById('output-title').textContent = "Output Area";
    document.getElementById('output-icon').textContent = "📄";
}

// Run init
init();
