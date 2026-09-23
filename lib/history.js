const fs = require('fs');
const path = require('path');
const estimator = require('./estimator');

const DATA_DIR = process.env.WP_HISTORY_DIR || path.join(__dirname, '..', 'data');
const BUCKET_FILE = path.join(DATA_DIR, 'buckets.json');

let bucketStore = { buckets: {} };
let bucketsLoaded = false;

function ensureBucketsLoaded() {
  if (bucketsLoaded) return;
  bucketsLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(BUCKET_FILE, 'utf8'));
    if (raw && raw.buckets && typeof raw.buckets === 'object') {
      for (const key of Object.keys(raw.buckets)) {
        if (Array.isArray(raw.buckets[key])) {
          bucketStore.buckets[key] = estimator.mergeBuckets([], raw.buckets[key]).buckets;
        }
      }
    }
  } catch (err) {}
}

function saveBuckets() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = BUCKET_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), buckets: bucketStore.buckets }));
    fs.renameSync(tmp, BUCKET_FILE);
  } catch (err) {}
}

function recordBuckets(key, candidates) {
  ensureBucketsLoaded();
  const res = estimator.mergeBuckets(bucketStore.buckets[key] || [], candidates);
  bucketStore.buckets[key] = res.buckets;
  if (res.added > 0) saveBuckets();
  return res.buckets;
}

function getBuckets(key) {
  ensureBucketsLoaded();
  return (bucketStore.buckets[key] || []).slice();
}

module.exports = {
  recordBuckets,
  getBuckets
};
