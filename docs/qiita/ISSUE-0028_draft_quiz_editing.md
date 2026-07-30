# Flask + Reactで「公開後の履歴を壊さない」下書きクイズ編集を実装する

## はじめに

QuizVerseでは、作成したクイズを `draft` として保存し、作成者が確認してから公開します。公開管理の次に必要になったのが、作成後の下書きを修正する機能です。

更新APIを追加するだけなら簡単ですが、公開後の回答履歴があるクイズの問題や正答を変更すると、過去のスコアと現在の問題内容が一致しなくなります。また、編集・公開・回答送信が同時に動くと、処理途中の問題IDが削除される可能性があります。

今回は次の境界を設けました。

- 作成者本人だけが編集できる
- `draft` だけを編集できる
- プレイ履歴が1件でもあれば編集できない
- 問題・選択肢はトランザクション内で全置換する
- 編集・状態変更・プレイ送信を対象クイズ行ロックで直列化する
- 手動ID採番をPostgreSQL advisory lockで直列化する
- 初期読み込み失敗時は編集フォームを表示しない
- JWT期限切れ後も同じタブ内の未保存編集を復元する

## API設計

編集APIは一般公開APIと分離し、`/api/me/quizzes` 配下へ置きます。

```text
GET /api/me/quizzes/{quiz_id}
PUT /api/me/quizzes/{quiz_id}
```

一般公開のクイズ詳細APIは正答を返しません。編集フォームには現在の正答設定が必要なため、本人向けGETだけが `is_correct` を返します。

## 所有者を404で判定し、PUT時だけ行ロックする

本人所有ではないクイズには403ではなく404を返します。GETでは通常取得し、PUTでは編集可能性を確認する前に行ロックを取得します。

```python
def _owned_quiz_or_404(
    quiz_id: int,
    user_id: int,
    *,
    for_update: bool = False,
):
    query = Quiz.query.filter_by(
        id=quiz_id,
        author_user_id=user_id,
    )
    if for_update:
        query = query.with_for_update()

    quiz = query.first()
    if not quiz:
        return None, _editing_error(
            "quiz/not_found",
            "Quiz not found.",
            404,
        )
    return quiz, None
```

PUTでは `for_update=True` を指定します。

```python
quiz, not_found = _owned_quiz_or_404(
    quiz_id,
    user_id,
    for_update=True,
)
```

これにより、編集可能性の確認からcommitまで対象クイズ行をロックできます。

## 編集可能条件を共通化する

GETとPUTの両方で同じ条件を利用します。

```python
def _ensure_editable(quiz: Quiz):
    if quiz.status != QuizStatus.draft:
        return _editing_error(
            "quiz/not_editable",
            "Only draft quizzes can be edited.",
            409,
        )

    play_exists = db.session.query(QuizPlay.id).filter(
        QuizPlay.quiz_id == quiz.id
    ).first()
    if play_exists:
        return _editing_error(
            "quiz/edit_conflict",
            "This quiz has play history and cannot be edited.",
            409,
        )
    return None
```

公開中のクイズは一度アーカイブし、下書きへ戻せます。ただし、プレイ履歴がある場合は下書きへ戻しても編集不可です。履歴付き編集にはクイズの版管理が必要になります。

## 非オブジェクトJSONを400で拒否する

作成APIの入力バリデーターを再利用する前に、JSONがオブジェクトであることを確認します。

```python
payload = request.get_json(silent=True)
if payload is None:
    payload = {}
elif not isinstance(payload, dict):
    return _editing_error(
        "quiz/validation_error",
        "Request body must be a JSON object.",
        400,
    )

validated, validation_error = _validate_create_quiz_payload(payload)
if validation_error:
    return validation_error
```

配列・文字列・数値のJSONもHTML 500ではなく、統一されたJSON 400で返せます。

## 問題・選択肢をトランザクションで全置換する

MVPでは問題単位の差分更新ではなく、全置換を採用しました。

```python
try:
    Choice.query.filter(
        Choice.question_id.in_(existing_question_ids)
    ).delete(synchronize_session=False)
    Question.query.filter(
        Question.id.in_(existing_question_ids)
    ).delete(synchronize_session=False)

    quiz.title = validated["title"]
    quiz.description = validated["description"]
    quiz.category = validated["category"]
    quiz.updated_at = datetime.now(timezone.utc)

    # validated questions / choicesを再作成
    db.session.commit()
except Exception:
    db.session.rollback()
```

入力検証を完了してから削除を始め、途中で失敗した場合はロールバックします。

全置換では問題IDが変わるため、プレイ履歴があるクイズには利用しません。

## 編集・公開・プレイを同じクイズ行ロックで直列化する

次の3処理は、状態や問題を確認する前に対象クイズ行へ `SELECT ... FOR UPDATE` を行います。

```text
編集PUT                  状態変更PATCH              プレイ送信POST
   │                          │                          │
   ├─ Quiz行をFOR UPDATE      ├─ Quiz行をFOR UPDATE      ├─ Quiz行をFOR UPDATE
   ├─ draft / 履歴確認         ├─ 状態 / 公開条件確認      ├─ 公開状態・問題確認
   ├─ 全置換                  ├─ 状態更新                ├─ 採点・履歴保存
   └─ commit                  └─ commit                  └─ commit
```

どれか1つがロックを取得すると、同じクイズを扱うほかの処理はcommitまで待機します。

- 進行中プレイが先なら、履歴保存後に編集が再確認して409
- 編集が先なら、プレイは編集完了後の公開状態を再確認
- 状態変更と編集も、確定済みの最新状態を前提に検証

これにより、回答送信中の問題IDを編集処理が削除する競合を防げます。

## `MAX(id) + 1` 採番をadvisory lockで直列化する

既存実装は問題・選択肢IDを `MAX(id) + 1` で採番しています。異なるクイズを同時作成・同時編集すると、同じ次IDを算出する可能性があります。

外部キー参照先の行を共有ロックに使うと、別処理のFK確認と循環待機してデッドロックになる可能性があります。そこでPostgreSQLのトランザクション単位advisory lockを利用します。

```python
from sqlalchemy import text

ID_ALLOCATION_ADVISORY_LOCK_KEY = 7249820371234


def _lock_shared_id_allocation():
    bind = db.session.get_bind()
    if bind.dialect.name == "postgresql":
        return db.session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": ID_ALLOCATION_ADVISORY_LOCK_KEY},
        ).scalar()

    # SQLiteなどのテスト環境向けフォールバック
    return (
        db.session.query(User.id)
        .order_by(User.id.asc())
        .with_for_update()
        .first()
    )
```

クイズ作成POSTと編集PUTだけが、採番前に同じadvisory lockを取得します。ロックはトランザクション終了時に自動解放されます。

プレイ送信は問題・選択肢IDを採番しないためadvisory lockを取得せず、対象クイズ行だけをロックします。これにより通常のプレイ送信同士を不要に直列化せず、FK参照先の行ロックとのデッドロックも回避できます。

恒久的にはPostgreSQLのsequence / identityへ移行する方が自然です。

## React側でAPIデータをフォームモデルへ変換する

APIはスネークケース、フォームはReact向けのキャメルケースを使っています。

```javascript
export function buildQuizDraftFromEditableQuiz(quiz) {
  return {
    title: quiz.title ?? '',
    description: quiz.description ?? '',
    category: quiz.category ?? '',
    questions: quiz.questions.map((question) => createQuestion({
      body: question.body,
      explanation: question.explanation,
      choices: question.choices.map((choice) => ({
        body: choice.body,
        isCorrect: choice.is_correct === true,
      })),
    })),
  }
}
```

既存の作成フォームと同じ検証・payload生成を編集画面でも利用できます。

## 読み込み失敗時に空フォームを出さない

編集画面の初期値は空のフォームモデルです。API取得に失敗したままフォームを表示すると、既存データと誤認して上書きする危険があります。

```text
loading  : 読み込み中
loaded   : 正常取得済み
loadError: 取得失敗
```

`loaded` がtrueになるまで編集フォームを描画せず、失敗時は再試行と一覧へ戻る操作だけを表示します。

## JWT期限切れ後も未保存編集を復元する

PUT送信時にJWTが期限切れになると、共通APIクライアントはセッションを削除してログイン画面へ遷移します。そこでクイズIDごとのキーで `sessionStorage` へフォームを一時保存します。

```text
quizverse_quiz_edit_draft:{quiz_id}
```

一時保存には、フォーム値と編集APIから取得した `updated_at` を含めます。

```javascript
saveEditableQuizDraft(quizId, serverUpdatedAt, draft)
```

再認証後はサーバーから最新データを取得し、次のように判定します。

- 一時保存時とサーバーの `updated_at` が一致: 未保存編集を復元
- 一致しない: 古い一時保存を破棄
- PUT成功: 一時保存を削除

これにより、期限切れ時のデータ損失を防ぎつつ、古いローカルデータで新しいサーバー状態を上書きしません。

## テスト方針

バックエンドでは次を確認します。

- 本人だけが正答付き編集データを取得できる
- 他ユーザーのGET / PUTは404
- draftを全置換できる
- 入力不正時に既存内容が残る
- 非オブジェクトJSONはJSON形式の400
- published / archivedは409
- プレイ送信前に対象クイズ行ロックを取得する
- プレイ送信は採番advisory lockを取得しない

フロントエンドでは次を確認します。

- APIデータをフォームモデルへ復元できる
- フォームをPUT payloadへ正規化できる
- GET / PUTへJWT、正しいパス、メソッド、bodyを送る
- 同じサーバー更新日時なら一時保存を復元する
- 更新日時が変わった古い一時保存を破棄する
- PUT成功後に一時保存を削除する

## まとめ

編集機能では「更新できること」だけでなく、「過去の結果を壊さないこと」と「競合時に古い状態を公開・採点しないこと」が重要です。

MVPでは、draft限定・プレイ履歴なし・全置換・クイズ行ロック・採番advisory lock・再認証用一時保存によって、実装の単純さと履歴の整合性を両立しました。将来はクイズの版管理とDB sequence / identityへ拡張できます。
