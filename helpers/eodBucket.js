const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { buildEodFile } = require('./eodFile');

// Running number of the first file in an empty folder, as in the sample from the bank
const FIRST_RUNNING_NO = 27743;

function yyyymmdd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(date).replaceAll('-', '');
}

/**
 * S3 folder the payment reconcile job reads EOD files from. Files are named `<running no.>_<YYYYMMDD>.txt`;
 * the running number has no fixed length and goes on across days, it only has to be unique. The job only processes the latest uploaded file.
 */
class EodBucket {
  /** @param {{ region: string, bucket: string, prefix: string, accessKeyId: string, secretAccessKey: string }} config */
  constructor({ region, bucket, prefix, accessKeyId, secretAccessKey }) {
    this.client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
    this.bucket = bucket;
    this.prefix = prefix.replace(/\/$/, '');
  }

  async fileNames() {
    const names = [];
    let ContinuationToken;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket, Prefix: `${this.prefix}/`, ContinuationToken,
      }));
      names.push(...(page.Contents || []).map((o) => o.Key.slice(this.prefix.length + 1)));
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
    return names;
  }

  /** Highest running number in the folder (any day) + 1, so an upload never overwrites a file */
  async nextRunningNo() {
    const used = (await this.fileNames()).map((name) => name.match(/^(\d+)_\d{8}\.txt$/)?.[1]).filter(Boolean).map(Number);
    return used.length ? Math.max(...used) + 1 : FIRST_RUNNING_NO;
  }

  /**
   * Builds and uploads today's EOD file
   * @param {{ companyAccount: string, payments: { refCode: string, amount?: number }[], date?: Date }} options
   * @returns {Promise<string>} the uploaded file name
   */
  async upload({ companyAccount, payments, date = new Date() }) {
    const runningNo = await this.nextRunningNo();
    const name = `${runningNo}_${yyyymmdd(date)}.txt`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${this.prefix}/${name}`,
      Body: buildEodFile({ runningNo, companyAccount, payments, date }),
      ContentType: 'text/plain',
    }));
    return name;
  }
}

module.exports = { EodBucket };
