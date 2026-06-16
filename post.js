#!/usr/bin/env node
/**
 * X (Twitter) 自動投稿スクリプト
 * 使い方:
 *   node post.js morning         # 07:00 価値コンテンツ
 *   node post.js noon            # 12:00 物件情報#1
 *   node post.js evening         # 20:00 物件情報#2
 *   node post.js morning --dry-run  # プレビューのみ（投稿しない）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// ─── .env 読み込み ───────────────────────────────────────────────────────────
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.env'),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) {
          process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
        }
      });
      console.log(`[env] 読み込み: ${p}`);
      return;
    }
  }
  console.log('[env] .envファイルが見つかりません。環境変数から読み込みます。');
}

// ─── 設定 ────────────────────────────────────────────────────────────────────
loadEnv();

const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://x-realestate-autopost.univcorp2.workers.dev/run';
const CF_ADMIN_TOKEN = process.env.CF_ADMIN_TOKEN || '';
const ESTATEBOARD_PATH = process.env.ESTATEBOARD_PATH
  || path.join(__dirname, '..', 'EstateBoard', 'output', 'received');
const STATE_FILE = path.join(__dirname, 'posted_state.json');
const VALUE_POSTS_FILE = path.join(__dirname, 'value_posts.json');
const ERROR_LOG = path.join(__dirname, 'cf_worker_error.log');

const MODE = (process.argv[2] || '').toLowerCase();
const DRY_RUN = process.argv.includes('--dry-run');

// ─── モックデータ ──────────────────────────────────────────────────────────
const MOCK_PROPERTIES = [
  {
    id: 'mock_001',
    name: '【モックデータ】平塚市大神 新築木造アパート10戸',
    address: '神奈川県平塚市大神',
    price_man: 7250,
    yield_pct: 9.2,
    units: 10,
    station: '平塚駅',
    walk_min: 12,
    broker_ok: true,
    posted: false,
    land_area: 320,
    building_area: 280,
    structure: '木造2階建',
    year_built: 2024,
  },
  {
    id: 'mock_002',
    name: '【モックデータ】川崎市多摩区 新築木造アパート12戸',
    address: '神奈川県川崎市多摩区',
    price_man: 9800,
    yield_pct: 8.7,
    units: 12,
    station: '登戸駅',
    walk_min: 8,
    broker_ok: true,
    posted: false,
    land_area: 420,
    building_area: 380,
    structure: '木造3階建',
    year_built: 2025,
  },
  {
    id: 'mock_003',
    name: '【モックデータ】さいたま市浦和区 新築木造アパート9戸',
    address: '埼玉県さいたま市浦和区',
    price_man: 6500,
    yield_pct: 8.9,
    units: 9,
    station: '浦和駅',
    walk_min: 14,
    broker_ok: false,
    posted: false,
    land_area: 280,
    building_area: 240,
    structure: '木造2階建',
    year_built: 2024,
  },
];

// ─── ユーティリティ ───────────────────────────────────────────────────────────
function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(ERROR_LOG, line, 'utf8');
  console.error('[ERROR]', msg);
}

function countChars(str) {
  return [...str].length;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { posted_ids: [], value_index: 0 };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { posted_ids: [], value_index: 0 };
  }
}

function saveState(state) {
  if (DRY_RUN) {
    console.log('[dry-run] posted_state.json は更新しません');
    return;
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ─── EstateBoard データ読み込み ───────────────────────────────────────────────
function loadProperties() {
  // フォルダが存在しない場合はモックデータを返す
  if (!fs.existsSync(ESTATEBOARD_PATH)) {
    console.log(`[estate] EstateBoardパスが存在しません: ${ESTATEBOARD_PATH}`);
    console.log('[estate] モックデータを使用します');
    return MOCK_PROPERTIES;
  }

  const files = fs.readdirSync(ESTATEBOARD_PATH);
  if (files.length === 0) {
    console.log('[estate] receivedフォルダが空です。モックデータを使用します');
    return MOCK_PROPERTIES;
  }

  const properties = [];
  for (const file of files) {
    const fp = path.join(ESTATEBOARD_PATH, file);
    try {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.json') {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        // 単体オブジェクトか配列かを両対応
        const arr = Array.isArray(data) ? data : [data];
        properties.push(...arr);
      } else if (ext === '.csv') {
        // シンプルなCSVパーサー（ヘッダー行あり前提）
        const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
        if (lines.length < 2) continue;
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
          const obj = {};
          headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
          properties.push(obj);
        }
      }
    } catch (e) {
      logError(`ファイル読み込みエラー: ${fp} - ${e.message}`);
    }
  }

  if (properties.length === 0) {
    console.log('[estate] 物件データを読み込めませんでした。モックデータを使用します');
    return MOCK_PROPERTIES;
  }

  console.log(`[estate] ${properties.length}件の物件データを読み込みました`);
  return properties;
}

// ─── 仲介回しOK判定 ──────────────────────────────────────────────────────────
// 複数のフィールド名に対応
function isBrokerOk(prop) {
  const okFields = ['broker_ok', 'brokerOk', '仲介回しOK', '仲介回し', 'mediation_ok', 'mediationOk',
                    'broker_enabled', 'is_broker_ok', '仲介可'];
  for (const f of okFields) {
    if (f in prop) {
      const v = prop[f];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return ['true', '1', 'yes', 'ok', '可', 'TRUE', 'OK'].includes(v.trim());
      if (typeof v === 'number') return v === 1;
    }
  }
  return false;
}

// ─── 投稿済み判定 ─────────────────────────────────────────────────────────────
function isPosted(prop, state) {
  return state.posted_ids.includes(getPropId(prop));
}

function getPropId(prop) {
  return prop.id || prop.物件ID || prop.property_id || prop.name || JSON.stringify(prop).slice(0, 40);
}

// ─── 物件投稿テキスト生成 ─────────────────────────────────────────────────────
function buildPropertyText(prop, slotNum) {
  const name    = prop.name    || prop.物件名    || prop.property_name || '物件情報';
  const address = prop.address || prop.住所      || prop.addr          || '';
  const price   = prop.price_man || prop.価格_万 || prop.price         || '';
  const yld     = prop.yield_pct || prop.表面利回り || prop.yield      || '';
  const units   = prop.units   || prop.戸数      || prop.unit_count    || '';
  const station = prop.station || prop.最寄り駅  || prop.nearest_station || '';
  const walk    = prop.walk_min || prop.徒歩分   || prop.walk_minutes  || '';

  // テキスト生成（140文字以内）
  let text = '';
  const tag = '#不動産投資 #収益物件';

  // バリエーション：価格あり版
  const pricePart = price ? `${price}万` : '';
  const yldPart   = yld   ? `利回り${yld}%` : '';
  const unitsPart = units ? `${units}戸` : '';
  const stationPart = station ? `${station}` : '';
  const walkPart  = walk  ? `徒歩${walk}分` : '';

  const locationLine = [stationPart, walkPart].filter(Boolean).join(' ');
  const specLine = [pricePart, yldPart, unitsPart].filter(Boolean).join(' / ');

  // 短縮版アドレス（都道府県+市区町村のみ）
  const shortAddr = address.split(/[市区町]/)[0] ? address.match(/(.{2,6}[都道府県].{2,6}[市区町])/)?.[1] || address.slice(0, 10) : address.slice(0, 10);

  text = `【物件情報${slotNum}】\n${shortAddr} ${locationLine}\n${specLine}\n仲介歓迎🤝\n${tag}`;

  // 140文字超の場合は短縮
  if (countChars(text) > 140) {
    text = `【物件】${shortAddr} ${yldPart} ${unitsPart}\n仲介歓迎🤝\n${tag}`;
  }
  if (countChars(text) > 140) {
    text = `【物件】${yldPart} ${unitsPart} 仲介可 ${tag}`;
  }

  return text;
}

// ─── Cloudflare Worker への POST ──────────────────────────────────────────────
function postToX(text) {
  return new Promise((resolve, reject) => {
    if (!CF_ADMIN_TOKEN) {
      reject(new Error('CF_ADMIN_TOKEN が設定されていません。.envファイルを確認してください。'));
      return;
    }

    const chars = countChars(text);
    if (chars > 140) {
      reject(new Error(`投稿テキストが${chars}文字（140文字超）: ${text.slice(0, 30)}...`));
      return;
    }

    const body = JSON.stringify({ text });
    const url = new URL(CF_WORKER_URL);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${CF_ADMIN_TOKEN}`,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('リクエストタイムアウト')); });
    req.write(body);
    req.end();
  });
}

// ─── morning: 価値コンテンツ投稿 ─────────────────────────────────────────────
async function runMorning(state) {
  const posts = JSON.parse(fs.readFileSync(VALUE_POSTS_FILE, 'utf8'));
  const idx = (state.value_index || 0) % posts.length;
  const post = posts[idx];

  console.log(`[morning] 投稿 #${idx + 1}/${posts.length}: ${post.theme}`);
  console.log(`[morning] テキスト（${countChars(post.text)}文字）:\n${post.text}`);

  if (DRY_RUN) {
    console.log('[dry-run] 投稿をスキップしました');
    return;
  }

  await postToX(post.text);
  console.log('[morning] 投稿成功 ✅');
  state.value_index = (idx + 1) % posts.length;
  state.last_morning = new Date().toISOString();
}

// ─── noon / evening: 物件情報投稿 ────────────────────────────────────────────
async function runProperty(state, slotNum) {
  const props = loadProperties();

  // 仲介回しOK かつ 未投稿 の物件を抽出
  const targets = props.filter(p => isBrokerOk(p) && !isPosted(p, state));

  if (targets.length === 0) {
    console.log(`[slot${slotNum}] 投稿対象の物件がありません（仲介回しOK & 未投稿）`);
    return;
  }

  // 最初の未投稿物件を使用
  const prop = targets[0];
  const id = getPropId(prop);
  const text = buildPropertyText(prop, slotNum);

  console.log(`[slot${slotNum}] 物件: ${id}`);
  console.log(`[slot${slotNum}] テキスト（${countChars(text)}文字）:\n${text}`);

  if (DRY_RUN) {
    console.log('[dry-run] 投稿をスキップしました');
    return;
  }

  await postToX(text);
  console.log(`[slot${slotNum}] 投稿成功 ✅`);
  state.posted_ids.push(id);
  if (slotNum === 1) state.last_noon = new Date().toISOString();
  if (slotNum === 2) state.last_evening = new Date().toISOString();
}

// ─── メイン ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== X 自動投稿 [${MODE}]${DRY_RUN ? ' [DRY-RUN]' : ''} ===`);
  console.log(`実行時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log('');

  if (!['morning', 'noon', 'evening'].includes(MODE)) {
    console.error('使い方: node post.js [morning|noon|evening] [--dry-run]');
    process.exit(1);
  }

  if (!DRY_RUN && !CF_ADMIN_TOKEN) {
    console.error('[ERROR] CF_ADMIN_TOKEN が設定されていません');
    console.error('.env ファイルを作成するか、環境変数に CF_ADMIN_TOKEN を設定してください');
    process.exit(1);
  }

  const state = loadState();

  try {
    if (MODE === 'morning') {
      await runMorning(state);
    } else if (MODE === 'noon') {
      await runProperty(state, 1);
    } else if (MODE === 'evening') {
      await runProperty(state, 2);
    }
    saveState(state);
    console.log('\n=== 完了 ===');
  } catch (err) {
    logError(`[${MODE}] ${err.message}`);
    console.error('\n=== エラー ===');
    console.error(err.message);
    process.exit(1);
  }
})();
