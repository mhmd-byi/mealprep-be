const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const hasImageSignature = (buffer, contentType) => {
  if (contentType === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  }
  return (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
};

const decodeImageBody = ({ image, contentType } = {}) => {
  const extension = EXTENSIONS[contentType];
  if (!extension || typeof image !== 'string') {
    return { status: 400, message: 'Please choose a JPEG, PNG or WebP image.' };
  }
  const buffer = Buffer.from(image, 'base64');
  if (!hasImageSignature(buffer, contentType)) {
    return { status: 400, message: 'That file is not a valid image.' };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { status: 413, message: 'The image is too large. Please choose a smaller one.' };
  }
  return { buffer, contentType, extension };
};

module.exports = { decodeImageBody };
