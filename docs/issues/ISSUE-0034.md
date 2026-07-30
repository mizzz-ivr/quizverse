# ISSUE-0034: SQLAlchemy 2.x非推奨APIとLegacyAPIWarningを解消する

## 背景

バックエンドテストは成功していたが、`GET /api/auth/me`で`User.query.get()`を使用していたため、SQLAlchemy 2.xの`LegacyAPIWarning`が毎回出力されていた。

警告を放置すると、将来のSQLAlchemy更新時に削除済みAPIが実行時エラーへ変わる可能性がある。また、CIログへ継続的に警告が出ることで、新しい警告を見落としやすくなる。

## 対応内容

### ユーザー取得API

変更前:

```python
user = User.query.get(user_id)
```

変更後:

```python
user = db.session.get(User, user_id)
```

SQLAlchemy 2.xの`Session.get()`を利用し、主キーによるユーザー取得の挙動を維持する。

### 警告のCIエラー化

`backend/pytest.ini`を追加し、SQLAlchemyのLegacy API警告をテスト失敗として扱う。

```ini
[pytest]
filterwarnings =
    error::sqlalchemy.exc.LegacyAPIWarning
```

今後、`Query.get()`などのLegacy APIが再導入された場合は、CIで即座に検知できる。

## API互換性

`GET /api/auth/me`のレスポンス契約は変更しない。

- 存在するユーザー: `200 OK`
- トークンに紐づくユーザーが存在しない: `404 auth/user_not_found`
- 不正なidentity: `401 auth/invalid_identity`

## 回帰テスト

`backend/tests/test_sqlalchemy2_compatibility.py`を追加した。

確認内容:

- SQLAlchemy 2形式のユーザー取得で既存ユーザーを返せる
- 存在しないユーザーIDで従来どおり404を返す
- `LegacyAPIWarning`が発生した場合にpytestが失敗する

## CI確認結果

- バックエンドテスト: `90 passed`
- SQLAlchemy `LegacyAPIWarning`: `0件`
- pytest warnings summary: なし
- フロントエンドテスト: `49 passed, 0 failed`
- Production Build: 成功
  - JavaScript: 272.98 kB（gzip 75.47 kB）
  - CSS: 43.14 kB（gzip 7.31 kB）
  - build: 1.39秒

## DB・デプロイ影響

- DBスキーマ変更なし
- マイグレーション不要
- 環境変数追加なし
- APIレスポンス変更なし

## 関連

- GitHub Issue #34
- GitHub PR #35
- `backend/app/api/auth.py`
- `backend/pytest.ini`
- `backend/tests/test_sqlalchemy2_compatibility.py`
