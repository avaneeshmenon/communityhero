import heic2any from 'heic2any';

/**
 * Checks if a file is HEIC/HEIF based on its type or extension.
 */
export function isHeicFile(file: File): boolean {
  if (!file) return false;
  const type = file.type ? file.type.toLowerCase() : '';
  const name = file.name ? file.name.toLowerCase() : '';
  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

/**
 * Converts a HEIC/HEIF file to a JPEG File object.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    // 1. Try our high-reliability server-side conversion endpoint first
    console.log('[heicConverter] Uploading HEIC file to server for conversion:', file.name);
    const response = await fetch('/api/convert-heic', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/heic',
      },
      body: file, // Send the raw HEIC file in the body
    });

    if (response.ok) {
      const convertedBlob = await response.blob();
      const originalName = file.name || 'image.heic';
      const newFileName = originalName.replace(/\.(heic|heif)$/i, '') + '.jpg';
      console.log('[heicConverter] Server conversion successful, converted to JPEG:', newFileName);
      return new File([convertedBlob], newFileName, { type: 'image/jpeg' });
    } else {
      console.warn(`[heicConverter] Server conversion returned status ${response.status}, falling back to client-side`);
    }
  } catch (serverErr) {
    console.warn('[heicConverter] Server-side conversion failed, falling back to client-side conversion:', serverErr);
  }

  // 2. Client-side fallback if server-side is unavailable or fails
  try {
    // Safely resolve the heic2any function
    const convertFn = typeof heic2any === 'function' ? heic2any : (heic2any as any).default;
    if (typeof convertFn !== 'function') {
      throw new Error('heic2any library is not correctly imported or supported in this environment');
    }

    // Convert standard File object to a clean standard Blob to avoid any subclass properties issues
    const cleanBlob = new Blob([file], { type: file.type || 'image/heic' });

    let conversionResult: any;
    try {
      // Try standard JPEG conversion first
      conversionResult = await convertFn({
        blob: cleanBlob,
        toType: 'image/jpeg',
        quality: 0.8,
      });
    } catch (jpegErr) {
      console.warn('[heicConverter] image/jpeg conversion failed, trying default PNG conversion fallback...', jpegErr);
      // Fallback to PNG conversion (widely supported by all builds of heic2any/libheif)
      conversionResult = await convertFn({
        blob: cleanBlob,
        toType: 'image/png'
      });
    }

    const blob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
    
    // Create a new File from the blob
    const originalName = file.name || 'image.heic';
    const extension = blob.type === 'image/png' ? '.png' : '.jpg';
    const mimeType = blob.type || 'image/jpeg';
    const newFileName = originalName.replace(/\.(heic|heif)$/i, '') + extension;
    
    return new File([blob], newFileName, { type: mimeType });
  } catch (error) {
    console.error('[heicConverter] Client-side fallback conversion also failed:', error);
    throw new Error("Couldn't process this image, please try another photo or a screenshot");
  }
}
