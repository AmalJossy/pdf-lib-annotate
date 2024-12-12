declare global {
    interface Window {
        pdfjsLib: typeof import('pdfjs-dist'),
        PDFLib: typeof import('pdf-lib'),
    }
}

export {}