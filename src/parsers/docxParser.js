/**
 * Parses a DOCX file and extracts text using Mammoth.js.
 * @param {File} file - The DOCX file to parse.
 * @returns {Promise<string>} - The extracted text.
 */
export async function parseDocx(file) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();

        fileReader.onload = async function () {
            try {
                const arrayBuffer = this.result;

                // mammoth is globally available via CDN
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                resolve(result.value.trim());
            } catch (error) {
                reject(new Error("Failed to parse DOCX: " + error.message));
            }
        };

        fileReader.onerror = function () {
            reject(new Error("Failed to read DOCX file."));
        };

        fileReader.readAsArrayBuffer(file);
    });
}
