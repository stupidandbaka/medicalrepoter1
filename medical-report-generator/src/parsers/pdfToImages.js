/**
 * Renders each page of a PDF file to a base64 PNG image using pdf.js.
 * @param {File} file - The PDF file.
 * @param {number} scale - Render scale (1.5 = 150% zoom for readability).
 * @returns {Promise<string[]>} - Array of base64 PNG strings (without the data:image/png;base64, prefix).
 */
export async function pdfToImages(file, scale = 1.5) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();

        fileReader.onload = async function () {
            try {
                const typedarray = new Uint8Array(this.result);

                const loadingTask = window.pdfjsLib.getDocument({
                    data: typedarray,
                    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
                    cMapPacked: true
                });

                const pdf = await loadingTask.promise;
                const numPages = pdf.numPages;
                const images = [];

                for (let i = 1; i <= numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale });

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({ canvasContext: context, viewport }).promise;

                    // Get base64 data without the prefix
                    const dataUrl = canvas.toDataURL('image/png');
                    const base64 = dataUrl.split(',')[1];
                    images.push(base64);
                }

                resolve(images);
            } catch (error) {
                reject(new Error("Failed to render PDF to images: " + error.message));
            }
        };

        fileReader.onerror = function () {
            reject(new Error("Failed to read PDF file."));
        };

        fileReader.readAsArrayBuffer(file);
    });
}
