# QuizVerse MVP Core Schema (ISSUE-0003)

## 方針
- MVPに必要な認証・クイズ・プレイ履歴の最小テーブルへ限定。
- `rankings` は保存型で固定せず、**日次スナップショット保存 (`leaderboard_snapshots`)** を採用。
  - 理由: MVPではランキングAPIの応答安定性を優先しつつ、将来は集計SQLからmaterialized view化へ移行しやすいため。

## テーブル一覧

### users
- ユーザー基本情報。
- `email` はユニーク。
- `status`: `active/suspended/withdrawn`。
- `role`: `user/admin`。ISSUE-0038で追加し、既定値は`user`。
- 管理APIはJWTの有効性に加えて、DB上の`status=active`と`role=admin`を毎回確認する。

### user_oauth_accounts
- OAuthプロバイダ連携情報（MVPではGoogle想定）。
- `provider + provider_user_id` をユニーク制約。
- Google ID tokenの`email_verified`確認後に作成される。
- `ADMIN_BOOTSTRAP_EMAILS`を使う初期管理者昇格では、同じメールアドレスのGoogle連携が存在することを所有確認として利用する。

### otp_verifications
- OTP検証履歴。
- `destination`（メールアドレス等）と `channel`（MVPはemail）で送信先を識別。
- `purpose` を `login/signup/password_reset` で保持。
- `otp_hash`（ハッシュ保存）, `expires_at`, `consumed_at`, `attempt_count` で検証状態を管理。

### quizzes
- クイズ本体。
- 作成者は `author_user_id`。
- `status` は `draft/published/archived`。
- ISSUE-0009 で `category`（文字列, nullable）を追加し、一覧APIでのカテゴリ完全一致フィルタに利用。

### questions
- クイズ設問。
- `sort_order` と `points` を保持。

### choices
- 各設問の選択肢。
- `is_correct` で正誤を表現。
- ISSUE-0008 のMVP API仕様では1問あたり2〜6件、かつ正答は単一（`is_correct=true` は1件）をバリデーション。

### quiz_plays
- ユーザーのプレイ単位のセッション。
- `status` は `started/submitted/abandoned`。
- スコア・正解数などを保持。
- ISSUE-0010 で `POST /api/quizzes/{quiz_id}/play` から保存される。

### quiz_play_answers
- 各設問に対する回答履歴。
- `selected_choice_id` はスキップ時にNULL許容。
- `result` は `correct/incorrect/skipped`。
- ISSUE-0010 では回答順ではなく `question_id` 基準で採点し、全設問ぶん保存する。

### leaderboard_snapshots
- 日次・クイズ単位のランキングスナップショット。
- `snapshot_date + quiz_id + user_id` ユニーク。

### email_settings
- ISSUE-0015で追加した管理向けメール設定テーブル（単一レコード運用）。
- 送信元情報、SMTP接続情報、TLS/SSL利用フラグを保持。
- `smtp_password_encrypted` は平文を保持せず、アプリケーションレイヤで暗号化した値を保存。

### audit_logs
- 監査ログ最小構成。
- 操作者、操作種別、対象エンティティ、メタ情報(JSON)を保持。

## 仮置き仕様（後続Issueで確定）

- クイズ作成API（ISSUE-0008）は `POST /api/quizzes` で quiz/questions/choices を入力順 `sort_order` として一括登録。
- クイズ一覧/詳細API（ISSUE-0009）は公開向けレスポンスで正答情報を返さない。
- クイズ回答API（ISSUE-0010）はJWT必須で、未回答設問は `skipped` として保存する（仮置き）。
- クイズ作成時の `quizzes.status` は `draft` 固定（公開制御は後続Issue）。
- OTP送信チャネルは現時点で `email` のみ実装。`phone` はAPIインターフェースのみ先行。
- ランキング集計バッチの実行タイミング（日次/時間単位）は未確定。
- `audit_logs.metadata` の構造はイベントごとに運用で定義。
- メール設定は `email_settings` 単一レコード管理（MVP仮置き）。
- `smtp_password_encrypted` の暗号鍵運用（ローテーション/復旧）は後続Issueで設計。
- 管理画面からのロール変更、最終管理者保護、ユーザー停止操作はISSUE-0038の対象外。
