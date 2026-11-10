const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { buildEodFile } = require('./eodFile');

// Running number of the first file in an empty folder, as in the sample from the bank
const FIRST_RUNNING_NO = 27743;

function yyyymmdd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(date).replaceAll('-', '');
}

/**
 * S3 folder the payment reconcile job reads EOD files from. Files are named `<running no.>_<YYYYMMDD>.txt`; the running
 * number has no fixed length and goes on across days. Every 5 minutes the job processes the latest uploaded file and
 * moves it to `success/` or `failed/` as `<name>_<processed at>.txt`; a name it has seen before is moved without being
 * read, so every upload needs a new running number.
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

  /** Highest running number in the folder and its subfolders (any day) + 1 */
  async nextRunningNo() {
    const used = (await this.fileNames()).map((name) => name.match(/(?:^|\/)(\d+)_\d{8}(?:_\d+)?\.txt$/)?.[1]).filter(Boolean).map(Number);
    return used.length ? Math.max(...used) + 1 : FIRST_RUNNING_NO;
  }

  /**
   * Builds and uploads today's EOD file
   * @param {{ companyCode: string, companyAccount: string, payments: { refCode?: string, reference1?: string, amount?: number }[], date?: Date }} options
   * @returns {Promise<string>} the uploaded file name
   */
  async upload({ companyCode, companyAccount, payments, date = new Date() }) {
    const runningNo = await this.nextRunningNo();
    const name = `${runningNo}_${yyyymmdd(date)}.txt`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${this.prefix}/${name}`,
      Body: buildEodFile({ companyCode, companyAccount, payments, date }),
      ContentType: 'text/plain',
    }));
    return name;
  }

  /**
   * Waits until the job has moved an uploaded file, for checks that the file changed nothing
   * @returns {Promise<'success' | 'failed'>} the folder it was moved to
   */
  async waitUntilProcessed(name, { timeout = 8 * 60 * 1000, interval = 15000 } = {}) {
    const moved = new RegExp(`^(success|failed)/${name.replace(/\.txt$/, '')}_\\d+\\.txt$`);
    for (const deadline = Date.now() + timeout; Date.now() < deadline;) {
      const folder = (await this.fileNames()).map((n) => n.match(moved)?.[1]).find(Boolean);
      if (folder) return folder;
      await new Promise((resolve) => { setTimeout(resolve, interval); });
    }
    throw new Error(`reconcile job did not process ${name} within ${timeout / 60000} minutes`);
  }
}

module.exports = { EodBucket };
