import JSZip from 'jszip';

export class ProjectZipper {
    constructor() {
        this.zip = new JSZip();
    }

    addFile(path, content) {
        this.zip.file(path, content);
    }

    async generateBlob() {
        return await this.zip.generateAsync({ type: 'blob' });
    }
}

export function saveAs(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

