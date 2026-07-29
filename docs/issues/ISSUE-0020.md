# ISSUE-0020: 一般ユーザー向けUIのセッション同期とクイズ概要表示を修正する

## 背景
PR #19 のマージ後レビューで、一般ユーザー向けクイズ体験UIに次の2件の不具合が検出された。

1. access token付きリクエストが401になった際、`localStorage`のみ削除され、Reactの`session` stateが残る。
2. クイズ一覧APIは説明文を`description_summary`として返すが、カード側は`description`を参照している。

この状態では、期限切れトークンを持つユーザーが画面上ではログイン中のままになり、クイズカードには登録済み説明文が表示されない。

## 対応方針

### 401時のセッション失効
APIクライアントで、**access tokenを付与したリクエスト**が401を返した場合のみ次を実行する。

- 401になったトークンと`localStorage`上の現行トークンが一致するか確認する
- 一致する場合のみ`quizverse_access_token`と`quizverse_user`を削除する
- 通常画面では`/login`へ遷移する
- すでに`/login`上の場合はページを再読み込みし、Reactのセッションstateを再初期化する

ログインAPIの認証情報誤りも401を返すため、access tokenを付与していないリクエストではセッション失効処理を実行しない。また、古いリクエストが遅れて401を返した場合でも、後から保存された新しいトークンを破棄しない。

> 仮置き: MVPではページ遷移または再読み込みによる再初期化を採用する。将来的にルーターや認証Contextを導入した場合は、SPA内でセッションstateを同期する方式へ置き換える。

### クイズ一覧レスポンスの正規化
`GET /api/quizzes`のレスポンスをAPIクライアントで正規化し、各itemへカード表示用の`description`を補完する。

優先順位:

1. `description`
2. `description_summary`
3. 空文字

APIの元フィールド`description_summary`は削除せず保持する。

## テスト
Node.js標準の`node:test`を使用し、追加依存なしで次を検証する。

- 認証付きリクエストの401で保存セッションが削除される
- 認証付きリクエストの401で`/login`へ遷移する
- `/login`上のセッション失効でページを再読み込みする
- 古いリクエストの401で新しいセッションを破棄しない
- ログイン失敗の401ではセッション失効処理を実行しない
- `description_summary`がカード用`description`へ正規化される
- 既存の`description`がある場合は上書きしない

実行コマンド:

```bash
npm --prefix frontend test
npm --prefix frontend run build
cd backend && PYTHONPATH=. pytest
```

## 確認結果
- フロントエンド回帰テスト: `5 passed, 0 failed`
- フロントエンドProduction Build: 成功
  - JavaScript: 199.28 kB（gzip 60.23 kB）
  - CSS: 35.68 kB（gzip 6.44 kB）
  - build: 1.38秒
- バックエンドテスト: `52 passed, 1 warning`
- 警告: `User.query.get()` に関するSQLAlchemy 2.x LegacyAPIWarning
- Vercel Preview: Vercelチームに`quizverse`プロジェクトが未作成のため未確認

## 受け入れ条件
- [x] 401後に期限切れセッションを保持しない実装になっている
- [x] ログイン失敗とセッション失効を区別している
- [x] 古い401レスポンスで新しいセッションを破棄しない
- [x] `/login`上でもReactセッションを再初期化できる
- [x] クイズ一覧の説明文を正しく表示できるデータ構造へ正規化している
- [x] フロントエンド回帰テストを追加している
- [x] GitHub Actionsでフロントエンドテストを実行する
- [x] GitHub Actionsの全ジョブが成功する
- [ ] Vercel環境で認証失効とクイズ一覧表示を確認する

## 関連
- GitHub Issue #20
- GitHub PR #19
- GitHub PR #23
- `frontend/src/public/api.js`
- `frontend/tests/public-api.test.js`
