# QuizVerse 開発 #17: Vite + Flask のモノレポを Vercel にデプロイする

## はじめに
QuizVerse は React + Vite のフロントエンドと Flask のバックエンドを同一リポジトリで管理しています。ローカルでは Docker Compose を利用していますが、Preview / Production 環境は Vercel に統一することにしました。

この記事では、Vite の静的ファイルと Flask の Python Function を単一 Vercel プロジェクトで配信する構成を整理します。

## 構成
- frontend: Vite で `frontend/dist` を生成
- backend: `api/index.py` から既存の Flask App Factory を読み込む
- `/api/*`: Flask Function へ rewrite
- その他: SPA の `index.html` へ rewrite
- DB: 外部 PostgreSQL を `DATABASE_URL` で接続

## Flask エントリーポイント
既存の `backend/app:create_app` を再利用し、Vercel が読み込める `app` オブジェクトを公開します。

```python
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import create_app

app = create_app()
```

App Factory を維持したまま、Vercel 専用コードを薄いアダプターに限定できる点がポイントです。

## vercel.json

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "npm --prefix frontend install",
  "buildCommand": "npm --prefix frontend run build",
  "outputDirectory": "frontend/dist",
  "functions": {
    "api/index.py": {
      "maxDuration": 30
    }
  },
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index.py"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

API rewrite を SPA fallback より先に記述します。順番を逆にすると `/api/health` まで `index.html` に流れる可能性があります。

## Python 依存関係
Vercel の Python Function が参照できるように、リポジトリ直下へ本番依存のみを記載した `requirements.txt` を配置します。テスト専用の `pytest` は含めません。

## PostgreSQL の扱い
Vercel 上で Docker Compose の `db` サービスは起動しません。外部の Managed PostgreSQL を用意し、Vercel Project Settings に `DATABASE_URL` を設定します。

マイグレーションは Function 起動時に自動実行せず、リリース作業として明示的に実施します。複数 Function の cold start が同時に走る環境で、自動マイグレーションを行うのは競合やロックの原因になるためです。

## 本番環境で必須の設定

```env
DATABASE_URL=postgresql+psycopg://...
SECRET_KEY=十分に長いランダム値
JWT_SECRET_KEY=十分に長いランダム値
AUTH_ENABLE_DEV_TOKEN_ENDPOINT=false
OTP_INCLUDE_CODE_IN_RESPONSE=false
```

Google OAuth やメール設定暗号化を利用する場合は、対応する環境変数も Preview / Production に登録します。

## テスト
`vercel.json` の rewrite 順序、Vercel entrypoint が Flask app を公開していること、root requirements に本番依存が存在することを pytest で検証します。

```bash
cd backend
PYTHONPATH=. pytest tests/test_vercel_deployment.py
```

## まとめ
Docker Compose はローカル再現性、Vercel は Preview / Production 配信という役割分担にしました。既存の Flask App Factory を崩さず、薄い entrypoint と rewrite 設定だけで Vite と Flask を同一ドメイン配下にまとめられます。

次は Vercel Preview 上で `/status` と `/api/health` を確認し、環境変数と外部 PostgreSQL を接続して Production デプロイへ進みます。
