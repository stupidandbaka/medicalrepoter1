/**
 * Parses a PPTX file and extracts text from slide XMLs using JSZip.
 * @param {File} file - The PPTX file to parse.
 * @returns {Promise<string>} - The extracted text.
 */
export async function parsePptx(file) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();

        fileReader.onload = async function () {
            try {
                // JSZip is globally available via CDN
                const zip = new JSZip();
                const contents = await zip.loadAsync(this.result);

                let extractedText = "";
                const slidePromises = [];

                // PPTX structure has slide XMLs in ppt/slides/
                contents.folder("ppt/slides/").forEach((relativePath, file) => {
                    if (relativePath.endsWith('.xml')) {
                        const promise = file.async("string").then(content => {
                            // Basic regex to strip out XML tags and get text within a:t tags
                            const tagsRegex = /<a:t[^>]*>(.*?)<\/a:t>/g;
                            let match;
                            let slideText = "";
                            while ((match = tagsRegex.exec(content)) !== null) {
                                slideText += match[1] + " ";
                            }
                            return slideText.trim();
                        });
                        slidePromises.push(promise);
                    }
                });

                const slidesText = await Promise.all(slidePromises);
                extractedText = slidesText.filter(text => text.length > 0).join("\n\n");

                resolve(extractedText.trim());
            } catch (error) {
                reject(new Error("Failed to parse PPTX: " + error.message));
            }
        };

        fileReader.onerror = function () {
            reject(new Error("Failed to read PPTX file."));
        };

        fileReader.readAsArrayBuffer(file);
    });
}
