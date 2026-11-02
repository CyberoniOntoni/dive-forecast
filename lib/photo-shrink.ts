import { MAX_PHOTO_BYTES, PHOTO_JPEG_QUALITY, PHOTO_LONG_EDGE_PX, PHOTO_PICK_MAX_BYTES } from "./site-photos-limits";

/**
 * Browser only. Draws a picked photo on a canvas no longer than PHOTO_LONG_EDGE_PX on its long edge and re-encodes it
 * as JPEG, which also drops its EXIF (GPS, camera). Steps the quality down until it fits MAX_PHOTO_BYTES.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  if (file.size > PHOTO_PICK_MAX_BYTES) throw new Error("That photo is over 30 MB.");
  const image = await decode(file);
  try {
    const scale = Math.min(1, PHOTO_LONG_EDGE_PX / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize photos.");
    context.drawImage(image.source, 0, 0, width, height);
    for (const quality of [PHOTO_JPEG_QUALITY, 0.7, 0.6, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) break;
      if (blob.size <= MAX_PHOTO_BYTES) return blob;
    }
    throw new Error("Could not make that photo small enough.");
  } finally {
    image.close();
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to an <img>, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.decoding = "async";
    element.src = url;
    await element.decode();
    return {
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That file is not a photo this browser can open.");
  }
}
