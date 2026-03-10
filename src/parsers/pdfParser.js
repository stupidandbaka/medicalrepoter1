/**
 * Parses a PDF file and extracts text using PDF.js.
 * @param {File} file - The PDF file to parse.
 * @returns {Promise<string>} - The extracted text.
 */
export async function parsePdf(file) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();

        fileReader.onload = async function () {
            try {
                const typedarray = new Uint8Array(this.result);

                // Configure CMap to support Japanese characters in PDFs
                const loadingTask = window.pdfjsLib.getDocument({
                    data: typedarray,
                    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
                    cMapPacked: true
                });

                const pdf = await loadingTask.promise;
                const numPages = pdf.numPages;
                let fullText = "";

                for (let i = 1; i <= numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(" ");
                    fullText += pageText + "\n\n";
                }

                resolve(fullText.trim());
            } catch (error) {
                reject(new Error("Failed to parse PDF: " + error.message));
            }
        };

        fileReader.onerror = function () {
            reject(new Error("Failed to read PDF file."));
        };

        fileReader.readAsArrayBuffer(file);
    });
}
