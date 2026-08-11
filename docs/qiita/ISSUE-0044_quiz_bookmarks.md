# Flask + Reactで「あとで遊ぶ」お気に入り機能を実装する

## はじめに

クイズ一覧から気になるコンテンツを見つけても、その場で遊ばない場合があります。そこでQuizVerseへ、ログインユーザーが公開クイズを保存し、後から専用一覧で見つけ直せる「あとで遊ぶ」機能を追加しました。

今回のポイントは、単なるブラウザ保存ではなく、DBへ永続化しながら公開状態・認証・CSRF・重複登録を安全に扱うことです。

## 1. 複合主キーで重複保存を防ぐ

お気に入りは「ユーザー」と「クイズ」の組み合わせそのものが一意です。

```python
class QuizBookmark(TimestampMixin, db.Model):
    __tablename__ = "quiz_bookmarks"

    user_id = db.Column(
        db.BigInteger,
        db.ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    quiz_id = db.Column(
        db.BigInteger,
        db.ForeignKey("quizzes.id", ondelete="CASCADE"),
        primary_key=True,
    )
```

新しい連番IDを作らず、`user_id + quiz_id`を複合主キーにします。これにより同じユーザーが同じクイズを二重保存することをDB制約で防げます。

## 2. PUT / DELETEを冪等にする

お気に入り追加は`PUT`、解除は`DELETE`にしました。

- 未保存 → PUT: `changed=true`
- 保存済み → PUT: `changed=false`
- 保存済み → DELETE: `changed=true`
- 未保存 → DELETE: `changed=false`

二重クリックや再送でエラーにしないため、画面側でも扱いやすくなります。

同時PUTで複合主キー競合が起きた場合はロールバック後に保存済み状態を再確認し、既に行が存在すれば成功として扱います。

## 3. 非公開化されたクイズを一覧へ漏らさない

お気に入り登録後にクイズがアーカイブされることがあります。

QuizVerseでは、お気に入り行を即削除せず、一覧取得時に`published`だけを結合します。

```python
query = query.filter(
    QuizBookmark.user_id == current_user.id,
    Quiz.status == QuizStatus.published,
)
```

この方式には次の利点があります。

- 非公開クイズが一般のお気に入り画面へ漏れない
- 再公開された場合は自動的に一覧へ戻る
- ユーザーの保存意図を不要に破棄しない

## 4. 状態確認でも非公開クイズを404にする

`GET /api/me/bookmarks/{quiz_id}`は、公開クイズだけを対象にします。

非公開クイズに対して「お気に入り済みか」を返すと、クイズIDから非公開コンテンツの存在を推測できる可能性があります。そのため、非公開・不存在は同じ404として扱います。

一方、`DELETE`はクイズ本体の公開状態を確認しません。既知のIDを持つユーザーが、非公開化後でも保存データを解除できるためです。

## 5. 一覧は保存日時順 + ページング

`GET /api/me/bookmarks`では次の順序を使います。

```python
order_by(
    QuizBookmark.created_at.desc(),
    QuizBookmark.quiz_id.desc(),
)
```

保存日時が同じ場合でも`quiz_id`をタイブレークに使い、ページング時の並びを安定させます。

## 6. Cookie認証ではCSRFを維持する

既存のQuizVerseはHttpOnly Cookie認証へ移行済みです。

お気に入りAPIも同じ方針を維持します。

- GET: `credentials: same-origin`
- PUT / DELETE: `credentials: same-origin`
- PUT / DELETE: CSRF Cookieを`X-CSRF-TOKEN`へ設定
- 401: 既存refresh処理を利用

JWT本体をlocalStorageへ保存しません。

## 7. React側は専用APIモジュールへ分離する

プロフィール機能と同じく、お気に入り固有のAPI呼び出しを`bookmarkApi.js`へ分離しました。

```js
publicApi.bookmarks = ({ page = 1, perPage = 12 } = {}) =>
  bookmarkRequest('/api/me/bookmarks', {
    query: { page, per_page: perPage },
  })

publicApi.addBookmark = (quizId) =>
  bookmarkRequest(`/api/me/bookmarks/${quizId}`, {
    method: 'PUT',
  })
```

画面側はHTTP詳細ではなく「一覧取得」「保存」「解除」といったユースケースだけを呼び出します。

## 8. UIは一覧と詳細アクションに分ける

### `/favorites`

- 保存件数
- クイズカード
- 保存日
- 保存解除
- プレイ導線
- ページング
- empty / loading / error

### `/quizzes/{id}`

公開クイズの場合だけ、固定の「あとで遊ぶ」ボタンを表示します。

未ログインで押した場合は、ログイン後に同じクイズ詳細へ戻る復帰先を保存します。

## 9. テストで確認する境界

バックエンドでは次を確認します。

- 初回保存
- 重複保存
- 解除と重複解除
- 本人スコープ
- 非公開クイズの追加拒否
- 非公開クイズの一覧除外
- 非公開化後の解除
- 未認証401
- 停止ユーザー403
- ページング
- migration revision
- 複合主キー・Index

フロントエンドでは次を確認します。

- Cookie資格情報
- CSRFヘッダー
- PUT / DELETE
- ページング値の正規化
- 保存日時表示
- Production Build

## まとめ

お気に入り機能は小さく見えますが、実装では次の境界が重要です。

- 重複登録をDB制約で防ぐ
- 操作を冪等にする
- 非公開コンテンツを一覧へ漏らさない
- 非公開化後もユーザーの保存意図は保持する
- Cookie認証のCSRF境界を崩さない
- UIからHTTP詳細を分離する

この土台があると、今後は「お気に入り数による人気順」「おすすめ」「通知」「コレクション」へ拡張しやすくなります。