import { ApiError, type ImportDocument } from '../api/types';
import { MAX_DOCUMENT_BYTES, validateFilename } from './documentValidation';

/**
 * Read a file the user chose in the browser's file picker. The name and size are checked
 * *before* the bytes are read, so an oversized or mis-named file is never loaded into memory.
 * Nothing here touches the network: the bytes go only to the local backend adapter.
 */
export async function readImportFile(file: File): Promise<ImportDocument> {
  validateFilename(file.name);
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new ApiError('validation', 'Files must be at most 1 MiB.');
  }
  const buffer = await readAsArrayBuffer(file);
  return { name: file.name, bytes: Array.from(new Uint8Array(buffer)) };
}

/** FileReader is used (rather than Blob.arrayBuffer) because it works in every supported WebView. */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new ApiError('validation', 'The selected file could not be read.'));
    };
    reader.onerror = () =>
      reject(new ApiError('validation', 'The selected file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}
