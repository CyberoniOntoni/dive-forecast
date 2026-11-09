import { describe, expect, it } from "vitest";
import { cleanJpeg, isPhotoKey, readPhotoBytes, savePhotoBytes } from "./site-photos";

function segment(marker: number, body: number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

/** A JPEG-shaped byte string: SOI, APP0, an EXIF APP1, a comment, an Adobe APP14, a frame, a scan and EOI. */
function fakeJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
    ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]),
    ...segment(0xfe, [0x68, 0x69]),
    ...segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65]),
    ...segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12, 0x34, 0xff, 0x00, 0x56,
    0xff, 0xd9,
  ]);
}

describe("cleanJpeg", () => {
  it("drops EXIF and comments and keeps everything else", () => {
    const clean = cleanJpeg(fakeJpeg())!;
    const text = Array.from(clean);
    expect(text).not.toContain(0xe1);
    expect(text).not.toContain(0xfe);
    expect(clean.length).toBe(fakeJpeg().length - 13 - 6);
    expect(Array.from(clean.subarray(-7))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
  });

  it("cuts the file at its end marker, so nothing appended after the image is kept", () => {
    const tail = [0x50, 0x4b, 0x03, 0x04, 0xff, 0xd9, 0x41];
    const clean = cleanJpeg(new Uint8Array([...fakeJpeg(), ...tail]))!;
    expect(Array.from(clean)).toEqual(Array.from(cleanJpeg(fakeJpeg())!));
  });

  it("walks every scan of a progressive JPEG, dropping camera data between them and keeping restart markers", () => {
    const scan = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...segment(0xc2, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
      ...scan, 0x12, 0xff, 0xd0, 0x34,
      ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 9]),
      ...segment(0xc4, [0, 1, 2]),
      ...scan, 0x56,
      0xff, 0xd9,
    ]);
    const clean = Array.from(cleanJpeg(bytes)!);
    expect(clean).not.toContain(0xe1);
    expect(clean).toContain(0xd0);
    expect(clean.length).toBe(bytes.length - 11);
  });

  it("refuses a stuffed byte or a second start of image outside a scan", () => {
    const frame = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x04, 0, 0, ...frame, 0xff, 0xd9]))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd8, 0x00, 0x04, 0, 0, ...frame, 0xff, 0xd9]))).toBeNull();
  });

  it("refuses a JPEG with no end marker", () => {
    const bytes = fakeJpeg();
    expect(cleanJpeg(bytes.subarray(0, bytes.length - 2))).toBeNull();
  });

  it("refuses bytes that are not a JPEG, or have no frame before the scan", () => {
    expect(cleanJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0xff, 0xd9]))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40]))).toBeNull();
  });
});

describe("photo storage on Node", () => {
  it("writes and reads back by site and photo id", async () => {
    const id = crypto.randomUUID();
    await savePhotoBytes("test-reef-1a2b3c4d", id, new Uint8Array([1, 2, 3]));
    expect(Array.from((await readPhotoBytes("test-reef-1a2b3c4d", id))!)).toEqual([1, 2, 3]);
    expect(await readPhotoBytes("test-reef-1a2b3c4d", crypto.randomUUID())).toBeNull();
  });

  it("only takes slug site ids and uuid photo ids", () => {
    expect(isPhotoKey("test-reef-1a2b3c4d", crypto.randomUUID())).toBe(true);
    expect(isPhotoKey("../store", crypto.randomUUID())).toBe(false);
    expect(isPhotoKey("reef", "../../x")).toBe(false);
  });
});
