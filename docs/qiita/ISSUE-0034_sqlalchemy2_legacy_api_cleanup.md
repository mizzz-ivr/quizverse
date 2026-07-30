# SQLAlchemy 2.xのLegacyAPIWarningをCIで確実に潰す

## はじめに

QuizVerseのバックエンドテストはすべて成功していましたが、認証ユーザー取得処理で次の警告が出続けていました。

```text
LegacyAPIWarning: The Query.get() method is considered legacy
```

テストが成功しているからといって警告を放置すると、将来のライブラリ更新で突然動かなくなる可能性があります。

今回は、SQLAlchemy 2.x推奨APIへの移行と、Legacy APIの再混入をCIで防ぐ設定を追加しました。

## 対象コード

変更前は、Flask-SQLAlchemyのModel Query経由で主キー検索していました。

```python
user = User.query.get(user_id)
```

`Query.get()`はSQLAlchemy 2.xではLegacy APIです。

## Session.get()へ移行する

変更後は、現在のSQLAlchemy Sessionから主キー検索します。

```python
user = db.session.get(User, user_id)
```

`Session.get()`は主キー検索用のAPIであり、今回の用途にそのまま対応できます。

レスポンス契約は変更しません。

```python
if not user:
    return _error_response(
        "auth/user_not_found",
        "User associated with token was not found.",
        404,
    )
```

## 警告をCI失敗へ変える

コードを1か所直すだけでは、別の実装で同じLegacy APIが再利用される可能性があります。

そこで`backend/pytest.ini`を追加しました。

```ini
[pytest]
filterwarnings =
    error::sqlalchemy.exc.LegacyAPIWarning
```

これにより、SQLAlchemyのLegacy API警告が1件でも発生するとpytestが失敗します。

すべての警告を一律エラー化すると、依存ライブラリ由来の警告で開発が止まることがあります。今回は対象を`LegacyAPIWarning`へ限定し、解消したい技術的負債だけをCIゲートにしました。

## API契約を回帰テストする

既存ユーザーと存在しないユーザーの2パターンを追加しました。

```python
def test_me_uses_sqlalchemy2_session_get_for_existing_user():
    client, token = _create_client_with_token(1, create_user=True)

    response = client.get("/api/auth/me", headers=_auth_header(token))

    assert response.status_code == 200
    assert response.get_json()["user"]["email"] == "user-1@example.com"
```

```python
def test_me_keeps_user_not_found_contract():
    client, token = _create_client_with_token(999, create_user=False)

    response = client.get("/api/auth/me", headers=_auth_header(token))

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "auth/user_not_found"
```

内部実装を変更しても、API利用者から見た200・404の挙動は維持されます。

## CI結果

```text
90 passed in 9.67s
```

以前表示されていたwarnings summaryはなくなり、`LegacyAPIWarning`は0件になりました。

フロントエンド側も影響確認しています。

```text
49 passed, 0 failed
```

Production Buildも成功しました。

## まとめ

今回の対応ポイントは次の3つです。

- `Query.get()`を`Session.get()`へ移行する
- Legacy API警告をpytestでエラー化する
- 内部実装だけでなく既存のAPI契約も回帰テストする

警告は「今は動いているが、将来壊れる可能性がある」という事前通知です。警告の種類を限定してCIゲートへ組み込むことで、ノイズを増やさずに技術的負債の再発を防げます。
