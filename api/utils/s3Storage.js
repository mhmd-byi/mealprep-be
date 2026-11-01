const readConfig = () => {
  const { S3_BUCKET_NAME, S3_REGION, S3_ACCESS_KEY, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET_NAME || !S3_REGION || !S3_ACCESS_KEY || !S3_SECRET_ACCESS_KEY) return null;
  return {
    bucket: S3_BUCKET_NAME,
    region: S3_REGION,
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_ACCESS_KEY
  };
};

const isConfigured = () => readConfig() !== null;

let cachedClient = null;

const getClient = (config) => {
  if (!cachedClient) {
    const { S3Client } = require('@aws-sdk/client-s3');
    cachedClient = new S3Client({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
  }
  return cachedClient;
};

const publicUrlFor = (config, key) =>
  `https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodeURIComponent(key)}`;

const uploadImage = async ({ buffer, contentType, key }) => {
  const config = readConfig();
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await getClient(config).send(
    new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: contentType })
  );
  return publicUrlFor(config, key);
};

const deleteImageByUrl = async (url) => {
  const config = readConfig();
  if (!config || !url) return;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== `${config.bucket}.s3.${config.region}.amazonaws.com`) return;
    const key = decodeURIComponent(parsed.pathname.slice(1));
    if (!key) return;
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    console.error('Could not delete old image from storage:', error.message);
  }
};

module.exports = { isConfigured, uploadImage, deleteImageByUrl };
