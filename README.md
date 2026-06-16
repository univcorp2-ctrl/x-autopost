# x-autopost

X (Twitter) 自動投稿スクリプト。1日3回、価値コンテンツ＋EstateBoard物件情報を投稿する。

## 投稿スケジュール

| 時刻 | 内容 | コマンド |
|------|------|---------|
| 07:00 | 価値コンテンツ（不動産tips/融資/節税/失敗談のローテーション） | `node post.js morning` |
| 12:00 | 物件情報 #1（EstateBoardから仲介回しOK物件） | `node post.js noon` |
| 20:00 | 物件情報 #2（EstateBoardから仲介回しOK物件） | `node post.js evening` |

## セットアップ

### 1. .envファイルを作成

```bash
cp .env.example .env
```

`.env`を編集してCF_ADMIN_TOKENを設定:

```
CF_ADMIN_TOKEN=your_cloudflare_admin_token_here
```

### 2. Windowsタスクスケジューラ登録

PowerShellを管理者として開いて実行:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
.\setup_scheduler.ps1
```

## 使い方

```bash
# 価値コンテンツ投稿（07:00タスク）
node post.js morning

# 物件情報#1投稿（12:00タスク）
node post.js noon

# 物件情報#2投稿（20:00タスク）
node post.js evening

# dry-run（投稿せずプレビューのみ）
node post.js morning --dry-run
node post.js noon --dry-run
```

## EstateBoard連携

`ESTATEBOARD_PATH`配下のJSONまたはCSVファイルを読み込む。

**仲介回しOK判定フィールド（いずれかに対応）:**
`broker_ok`, `brokerOk`, `仲介回しOK`, `仲介回し`, `mediation_ok`, `仲介可`

EstateBoardフォルダが存在しない場合はモックデータで動作する。

## ファイル構成

```
x-autopost/
├── post.js              # メインスクリプト
├── value_posts.json     # 価値コンテンツ21本（7テーマ×3本）
├── posted_state.json    # 投稿済みトラッキング（gitignore対象）
├── .env.example         # 環境変数テンプレート
├── .env                 # 実際の設定（gitignore対象・要作成）
├── .gitignore
├── setup_scheduler.ps1  # Windowsタスクスケジューラ登録
└── README.md
```

## エラーログ

エラーは `cf_worker_error.log` に記録される。

## 技術仕様

- Node.js 標準ライブラリのみ（依存パッケージなし）
- 投稿APIエンドポイント: `POST https://x-realestate-autopost.univcorp2.workers.dev/run`
- 140文字制限チェック付き
- 二重投稿防止: `posted_state.json` で管理
