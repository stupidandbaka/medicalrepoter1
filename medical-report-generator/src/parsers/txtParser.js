/**
 * Parses a TXT file and extracts text.
 * @param {File} file - The TXT file to parse.
 * @returns {Promise<string>} - The extracted text.
 */
export async function parseTxt(file) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();

        fileReader.onload = function () {
            resolve(this.result);
        };

        fileReader.onerror = function () {
            reject(new Error("Failed to read TXT file."));
        };

        fileReader.readAsText(file);
    });
}
