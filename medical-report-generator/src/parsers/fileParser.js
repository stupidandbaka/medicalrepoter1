import { parsePdf } from './pdfParser.js';
import { parseDocx } from './docxParser.js';
import { parsePptx } from './pptxParser.js';
import { parseTxt } from './txtParser.js';

/**
 * Routes the file to the appropriate parser based on its extension.
 * @param {File} file - The file to parse.
 * @returns {Promise<string>} - The extracted text.
 */
export async function extractTextFromFile(file) {
    if (!file) {
        throw new Error("No file provided.");
    }

    const extension = file.name.split('.').pop().toLowerCase();

    switch (extension) {
        case 'pdf':
            return await parsePdf(file);
        case 'docx':
            return await parseDocx(file);
        case 'pptx':
            return await parsePptx(file);
        case 'txt':
            return await parseTxt(file);
        default:
            throw new Error(`Unsupported file type: .${extension}`);
    }
}
