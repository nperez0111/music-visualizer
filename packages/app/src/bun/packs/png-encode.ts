import { zlibSync } from "fflate";

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
	if (CRC_TABLE) return CRC_TABLE;
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	CRC_TABLE = t;
	return t;
}

function crc32(bytes: Uint8Array): number {
	const t = crcTable();
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function writeU32BE(out: Uint8Array, offset: number, value: number): void {
	out[offset] = (value >>> 24) & 0xff;
	out[offset + 1] = (value >>> 16) & 0xff;
	out[offset + 2] = (value >>> 8) & 0xff;
	out[offset + 3] = value & 0xff;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	writeU32BE(out, 0, data.length);
	out[4] = type.charCodeAt(0);
	out[5] = type.charCodeAt(1);
	out[6] = type.charCodeAt(2);
	out[7] = type.charCodeAt(3);
	out.set(data, 8);
	const crcInput = out.subarray(4, 8 + data.length);
	writeU32BE(out, 8 + data.length, crc32(crcInput));
	return out;
}

/** Encode RGBA bytes (one byte per channel, no row padding) to a PNG byte stream. */
export function encodeRgbaPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
	if (rgba.length !== width * height * 4) {
		throw new Error(`encodeRgbaPng: expected ${width * height * 4} bytes, got ${rgba.length}`);
	}

	const ihdr = new Uint8Array(13);
	writeU32BE(ihdr, 0, width);
	writeU32BE(ihdr, 4, height);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 6;  // color type: RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	// Filter type 0 (None) per scanline — easy and small for our use case.
	const stride = width * 4;
	const filtered = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		filtered[y * (stride + 1)] = 0;
		filtered.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	const idatPayload = zlibSync(filtered, { level: 6 });

	const ihdrChunk = writeChunk("IHDR", ihdr);
	const idatChunk = writeChunk("IDAT", idatPayload);
	const iendChunk = writeChunk("IEND", new Uint8Array(0));

	const total = SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
	const png = new Uint8Array(total);
	let off = 0;
	png.set(SIGNATURE, off); off += SIGNATURE.length;
	png.set(ihdrChunk, off); off += ihdrChunk.length;
	png.set(idatChunk, off); off += idatChunk.length;
	png.set(iendChunk, off);
	return png;
}
