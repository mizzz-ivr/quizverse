# Flask + Reactでクイズの下書き・公開・アーカイブを安全に管理する

## はじめに

クイズ作成APIを実装した直後は、作成したデータを保存できるだけで満足しがちです。しかし、実際に公開サービスとして運用するには、次の境界を明確にする必要があります。

- 作成途中の下書きを誰が見られるか
- いつ一般ユーザーへ公開するか
- 公開を終了したデータをどう扱うか
- ランキングや回答履歴へどこまで影響させるか

QuizVerseでは、クイズ作成時に `draft` を保存していた一方、一覧・詳細・回答・ランキングAPIが状態を参照していませんでした。本記事では、既存のFlask APIとReact画面へ公開ライフサイクルを追加した設計を整理します。

## 状態を3つに分ける

既存モデルには次の状態が定義されていました。

```python
class QuizStatus(enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"
```

役割は次の通りです。

| 状態 | 用途 | 一般公開 |
| --- | --- | --- |
| `draft` | 作成途中・公開前確認 | しない |
| `published` | 公開中 | する |
| `archived` | 公開終了・保管 | しない |

重要なのは、単に状態カラムを持つだけでは不十分という点です。すべての公開APIで同じ判定を行う必要があります。

## 公開APIの境界を統一する

対象となったAPIは次の5種類です。

```text
GET  /api/quizzes
GET  /api/quizzes/{quiz_id}
POST /api/quizzes/{quiz_id}/play
GET  /api/quizzes/{quiz_id}/rankings
GET  /api/rankings
```

一覧だけで `published` を絞っても、IDを直接指定した詳細APIから下書きを取得できれば意味がありません。同様に、非公開クイズへ回答できたり、ランキングだけ見えたりする状態も避ける必要があります。

今回の実装では、公開クイズ関連ルートの直前に共通境界を置きました。

```python
@quiz_management_bp.before_app_request
def enforce_quiz_publication_visibility():
    if request.method == "GET" and request.path == "/api/quizzes":
        return published_quiz_list_response()

    # detail / play / ranking でも status を確認
```

既存APIの入力形式やレスポンス形式を大きく変更せず、公開判定だけを先に適用できる点が利点です。

## 非公開クイズは403ではなく404

下書きのIDを知っている第三者がアクセスした場合、403を返すと「そのIDのクイズが存在する」と推測できます。

そこで、作成者以外には404を返します。

```python
quiz = Quiz.query.filter_by(id=quiz_id).first()
if not quiz:
    return not_found()

if quiz.status == QuizStatus.published:
    return None

if current_user_id == quiz.author_user_id:
    return owner_preview(quiz)

return not_found()
```

これは「存在の秘匿」を目的とした判断です。

## 作成者だけが下書きをプレビューする

作成直後のクイズは `draft` です。一般公開はしませんが、作成者本人は内容を確認できる必要があります。

JWT identityと `author_user_id` が一致した場合のみ、詳細レスポンスを返します。

```json
{
  "viewer_is_author": true,
  "play_enabled": false,
  "management_path": "/my/quizzes"
}
```

正答フラグは作成者プレビューでも返しません。プレイヤー画面と同じ見え方を確認するためです。

また、下書き状態では回答送信を許可しません。プレビュー回答を通常ランキングへ混ぜないためです。

## 作成者向けAPIを分離する

一般公開APIとは別に、本人専用APIを追加しました。

### 自分のクイズ一覧

```text
GET /api/me/quizzes
```

主なqueryは次の通りです。

```text
status=all|draft|published|archived
page=1
per_page=20
```

レスポンスには管理画面で必要な情報だけを返します。

- ステータス
- 問題数
- プレイ数
- 更新日時
- 公開日時
- 公開URL
- プレビューURL

### 状態変更

```text
PATCH /api/me/quizzes/{quiz_id}/status
```

```json
{
  "status": "published"
}
```

所有者以外は404です。

## 状態遷移を制限する

状態変更を無制限にすると、運用ルールが曖昧になります。今回は次の遷移だけを許可しました。

```text
draft     -> published, archived
published -> archived
archived  -> draft, published
```

`published -> draft` を直接許可しないのは、「一度公開終了した」という履歴を `archived` で明示するためです。

## 公開前に構造を再検証する

作成APIで検証済みでも、公開操作時に再確認します。

- 問題が1件以上ある
- 各問題の選択肢が2〜6件
- 正答が各問題に1件

```python
if target_status == QuizStatus.published:
    publishable, reason = validate_publishable(quiz.id)
    if not publishable:
        return error("quiz/not_publishable", reason, 409)
```

将来、編集APIや管理操作が増えても、公開直前の最終防衛線になります。

## アーカイブ済みクイズをランキングから除外する

クイズを公開終了しても、プレイ履歴自体は削除しません。ただし、公開中の総合ランキングに含めると、ユーザーから見えないクイズの得点が順位へ影響します。

そのため、ベストプレイ抽出時に `Quiz.status == published` を加えます。

```python
.join(Quiz, Quiz.id == QuizPlay.quiz_id)
.filter(
    QuizPlay.status == PlayStatus.submitted,
    Quiz.status == QuizStatus.published,
)
```

データ保持と公開集計を分ける設計です。

## React側の画面構成

### マイクイズ画面

```text
/my/quizzes
```

実装した要素:

- JWT有効性確認
- 状態タブ
- ローディング・空状態・エラー
- 公開・公開終了・再公開
- アーカイブから下書きへ戻す
- プレビュー・公開ページ導線

### 独立した詳細画面

```text
/quizzes/{quiz_id}
```

公開状態によって表示を変えます。

- `published`: 回答フォームを表示
- 作成者の `draft / archived`: プレビューバナー、回答不可
- 第三者の非公開クイズ: 404画面

APIクライアントは保存済みJWTがある場合、詳細取得へ自動付与します。

```javascript
quiz: (quizId, accessToken = getStoredSession()?.accessToken) =>
  request(`/api/quizzes/${quizId}`, { accessToken })
```

公開済みクイズは匿名でも取得でき、下書きは本人だけが取得できます。

## テストで確認したこと

バックエンド:

- 下書きが公開一覧に出ない
- 第三者が下書きを取得できない
- 作成者だけがプレビューできる
- 下書きへ回答できない
- 公開・アーカイブ・復元
- 不正な状態遷移
- 他ユーザーの状態変更拒否
- アーカイブ済みクイズを総合ランキングから除外

フロントエンド:

- JWT付きマイクイズ取得
- 状態フィルターquery
- PATCH payload
- 詳細取得時の保存済みJWT付与

## まとめ

公開状態を導入するときは、一覧画面だけを変更するのではなく、次のすべてを同じ境界で考える必要があります。

- 一覧
- 詳細
- 操作
- 集計
- 作成者向け管理

`draft / published / archived` の役割と状態遷移を先に決め、公開APIと管理APIを分けることで、下書き漏えいを防ぎながら運用しやすい構成にできます。
